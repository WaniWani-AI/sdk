import type { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type {
	ServerNotification,
	ServerRequest,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { McpServer, RegisteredFlow } from "../@types";
import { isWidget } from "../@types";
import type {
	DynamicFlowConfig,
	DynamicFlowToolInput,
	FieldDefinition,
	SerializedField,
	WidgetField,
} from "./@types";

// ============================================================================
// Protocol — embedded in tool description
// ============================================================================

function buildDynamicProtocol(): string {
	return [
		"",
		"## DYNAMIC FORM PROTOCOL",
		"",
		"This tool uses an AI-driven form. You gather information through natural",
		"conversation instead of following rigid steps.",
		"",
		'1. Call with `action: "start"` to get the field requirements.',
		"2. The response tells you what information is needed:",
		"   - `fields`: Schema of all active fields (type, label, options, hints)",
		"   - `gathered`: What has already been collected",
		"   - `missing`: Required fields still needed",
		"   - `errors`: Validation errors for previously submitted values",
		"3. Gather the missing information through natural conversation:",
		"   - Ask about multiple related fields in one message when appropriate",
		"   - If the user already provided information, include it — don't re-ask",
		"   - Follow field `hint` values for questioning style guidance",
		"   - Respect `dependsOn` — gather dependency fields first",
		"   - For `select` fields, present the available options",
		"   - Fields with type `widget` are handled automatically — do NOT gather them",
		'4. Call with `action: "submit"` and `data` containing gathered values.',
		"5. Check the response `status`:",
		'   - `"gathering"`: More fields needed — see `missing` and `errors`',
		'   - `"widget"`: A widget UI is being shown — do NOT call again until callback',
		'   - `"complete"`: Done — present the `result` to the user',
		"",
		"Important:",
		"- Partial submissions are encouraged — submit what you have so far",
		"- ALWAYS pass back `state` exactly as received",
		"- Combine related questions naturally instead of asking one at a time",
		"- If a field has an error, explain the issue and ask for correction",
	].join("\n");
}

// ============================================================================
// Field serialization — strip functions for AI consumption
// ============================================================================

function serializeField(def: FieldDefinition): SerializedField {
	const base: SerializedField = {
		type: def.type,
		label: def.label,
		required: def.required !== false,
	};

	if (def.description) base.description = def.description;
	if (def.hint) base.hint = def.hint;
	if (def.dependsOn?.length) base.dependsOn = def.dependsOn;

	if (def.type === "select") {
		base.options = def.options;
	}
	if (def.type === "number") {
		if (def.min !== undefined) base.min = def.min;
		if (def.max !== undefined) base.max = def.max;
	}

	return base;
}

// ============================================================================
// Field resolution — determine active fields based on state
// ============================================================================

function getActiveFields(
	fields: Record<string, FieldDefinition>,
	state: Record<string, unknown>,
): Map<string, FieldDefinition> {
	const active = new Map<string, FieldDefinition>();

	for (const [name, def] of Object.entries(fields)) {
		// Check `when` condition
		if (def.when && !def.when(state)) {
			continue;
		}

		// Check `dependsOn` — all dependencies must be gathered
		if (def.dependsOn?.length) {
			const allDepsGathered = def.dependsOn.every(
				(dep) =>
					state[dep] !== undefined &&
					state[dep] !== null &&
					state[dep] !== "",
			);
			if (!allDepsGathered) continue;
		}

		active.set(name, def);
	}

	return active;
}

// ============================================================================
// Validation & coercion
// ============================================================================

async function validateField(
	value: unknown,
	def: FieldDefinition,
): Promise<string | null> {
	if (value === undefined || value === null || value === "") {
		return null; // Missing — handled separately
	}

	switch (def.type) {
		case "text": {
			if (typeof value !== "string") return `${def.label} must be text`;
			if (def.validate) {
				const result = await def.validate(value);
				if (result !== true) return result;
			}
			return null;
		}
		case "select": {
			const strValue = String(value);
			const validValues = Array.isArray(def.options)
				? def.options.map((o) => (typeof o === "string" ? o : o.value))
				: [];
			if (!validValues.includes(strValue)) {
				return `${def.label} must be one of: ${validValues.join(", ")}`;
			}
			return null;
		}
		case "number": {
			const num = typeof value === "number" ? value : Number(value);
			if (Number.isNaN(num)) return `${def.label} must be a number`;
			if (def.min !== undefined && num < def.min)
				return `${def.label} must be at least ${def.min}`;
			if (def.max !== undefined && num > def.max)
				return `${def.label} must be at most ${def.max}`;
			return null;
		}
		case "boolean": {
			if (
				typeof value !== "boolean" &&
				value !== "true" &&
				value !== "false"
			) {
				return `${def.label} must be true or false`;
			}
			return null;
		}
		case "widget": {
			return null; // Widget fields validated by the widget itself
		}
	}
}

function coerceValue(value: unknown, def: FieldDefinition): unknown {
	if (value === undefined || value === null) return value;

	switch (def.type) {
		case "number": {
			const num = typeof value === "number" ? value : Number(value);
			return Number.isNaN(num) ? value : num;
		}
		case "boolean": {
			if (typeof value === "boolean") return value;
			if (value === "true") return true;
			if (value === "false") return false;
			return value;
		}
		default:
			return typeof value === "string" ? value : String(value);
	}
}

// ============================================================================
// Processing logic
// ============================================================================

async function processSubmission(
	fields: Record<string, FieldDefinition>,
	currentState: Record<string, unknown>,
	newData: Record<string, unknown>,
): Promise<{
	state: Record<string, unknown>;
	activeFields: Map<string, FieldDefinition>;
	missing: string[];
	errors: Record<string, string>;
}> {
	// Merge new data into state with type coercion
	const state: Record<string, unknown> = { ...currentState };
	for (const [key, value] of Object.entries(newData)) {
		const def = fields[key];
		if (def) {
			state[key] = coerceValue(value, def);
		}
	}

	// Determine which fields are active given current state
	const activeFields = getActiveFields(fields, state);

	// Validate all gathered values
	const errors: Record<string, string> = {};
	for (const [name, def] of activeFields) {
		const value = state[name];
		if (value !== undefined && value !== null && value !== "") {
			const error = await validateField(value, def);
			if (error) {
				errors[name] = error;
				delete state[name]; // Remove invalid value
			}
		}
	}

	// Find missing required non-widget fields
	const missing: string[] = [];
	for (const [name, def] of activeFields) {
		if (def.required !== false && def.type !== "widget") {
			const value = state[name];
			if (value === undefined || value === null || value === "") {
				missing.push(name);
			}
		}
	}

	return { state, activeFields, missing, errors };
}

// ============================================================================
// Response builders
// ============================================================================

type ExecutionResult = {
	text: string;
	data: Record<string, unknown>;
	widgetMeta?: Record<string, unknown>;
};

function buildGatheringResponse(
	activeFields: Map<string, FieldDefinition>,
	state: Record<string, unknown>,
	missing: string[],
	errors: Record<string, string>,
): ExecutionResult {
	const serializedFields: Record<string, SerializedField> = {};
	for (const [name, def] of activeFields) {
		serializedFields[name] = serializeField(def);
	}

	const gathered: Record<string, unknown> = {};
	for (const [name] of activeFields) {
		const value = state[name];
		if (value !== undefined && value !== null && value !== "") {
			gathered[name] = value;
		}
	}

	const response = {
		status: "gathering" as const,
		fields: serializedFields,
		gathered,
		missing,
		errors,
		state,
	};

	return {
		text: JSON.stringify(response),
		data: response,
	};
}

function buildErrorResponse(
	error: string,
	state?: Record<string, unknown>,
): ExecutionResult {
	const response = { status: "error" as const, error, state };
	return { text: JSON.stringify(response), data: response };
}

function findPendingWidget(
	activeFields: Map<string, FieldDefinition>,
	state: Record<string, unknown>,
): { name: string; def: WidgetField } | null {
	for (const [name, def] of activeFields) {
		if (def.type === "widget" && def.required !== false) {
			const value = state[name];
			if (value === undefined || value === null) {
				return { name, def };
			}
		}
	}
	return null;
}

function buildWidgetResponse(
	fieldName: string,
	def: WidgetField,
	state: Record<string, unknown>,
	flowId: string,
): ExecutionResult {
	const resource = def.resource;
	return {
		text: JSON.stringify({
			status: "widget",
			field: fieldName,
			widgetId: resource.id,
			description: def.description,
			state,
		}),
		data: {
			...(def.data ?? {}),
			__flow: {
				flowId,
				step: fieldName,
				state,
			},
		},
		widgetMeta: {
			"openai/outputTemplate": resource.openaiUri,
			"openai/widgetAccessible": true,
			"openai/resultCanProduceWidget": true,
			ui: { resourceUri: resource.mcpUri },
		},
	};
}

// ============================================================================
// Compile
// ============================================================================

const inputSchema = {
	action: z
		.enum(["start", "submit", "widget_result"])
		.describe(
			'"start" to begin, "submit" to send gathered data, "widget_result" when a widget returns data',
		),
	data: z
		.record(z.string(), z.unknown())
		.optional()
		.describe("Gathered field values to submit"),
	step: z
		.string()
		.optional()
		.describe("The widget field name (for widget_result action)"),
	state: z
		.record(z.string(), z.unknown())
		.optional()
		.describe("Flow state — pass back exactly as received"),
	widgetResult: z
		.record(z.string(), z.unknown())
		.optional()
		.describe("Data returned by a widget callback"),
};

export function compileDynamicFlow<TState extends Record<string, unknown>>(
	config: DynamicFlowConfig<TState>,
): RegisteredFlow {
	const fields = config.fields as Record<string, FieldDefinition>;
	const protocol = buildDynamicProtocol();
	const fullDescription = `${config.description}\n${protocol}`;

	async function tryComplete(
		state: Record<string, unknown>,
		meta?: Record<string, unknown>,
	): Promise<ExecutionResult> {
		try {
			const result = await config.onComplete(
				state as TState,
				meta,
			);

			if (isWidget(result)) {
				const resource = result.resource;
				return {
					text: JSON.stringify({
						status: "widget",
						field: "__complete",
						widgetId: resource.id,
						description: result.description,
						state,
					}),
					data: {
						...result.data,
						__flow: {
							flowId: config.id,
							step: "__complete",
							state,
						},
					},
					widgetMeta: {
						"openai/outputTemplate": resource.openaiUri,
						"openai/widgetAccessible": true,
						"openai/resultCanProduceWidget": true,
						ui: { resourceUri: resource.mcpUri },
					},
				};
			}

			const response = {
				status: "complete" as const,
				result,
				state,
			};
			return { text: JSON.stringify(response), data: response };
		} catch (error) {
			const message =
				error instanceof Error ? error.message : String(error);
			return buildErrorResponse(message, state);
		}
	}

	async function handleSubmission(
		currentState: Record<string, unknown>,
		newData: Record<string, unknown>,
		meta?: Record<string, unknown>,
	): Promise<ExecutionResult> {
		const { state, activeFields, missing, errors } =
			await processSubmission(fields, currentState, newData);

		// Check if a widget field needs to be shown
		const pendingWidget = findPendingWidget(activeFields, state);
		if (
			missing.length === 0 &&
			Object.keys(errors).length === 0 &&
			pendingWidget
		) {
			return buildWidgetResponse(
				pendingWidget.name,
				pendingWidget.def,
				state,
				config.id,
			);
		}

		// All required fields gathered and valid — run onComplete
		if (missing.length === 0 && Object.keys(errors).length === 0) {
			return tryComplete(state, meta);
		}

		// Still gathering
		return buildGatheringResponse(activeFields, state, missing, errors);
	}

	async function handleToolCall(
		args: DynamicFlowToolInput,
		meta?: Record<string, unknown>,
	): Promise<ExecutionResult> {
		const currentState = args.state ?? {};

		if (args.action === "start") {
			return handleSubmission(currentState, args.data ?? {}, meta);
		}

		if (args.action === "submit") {
			return handleSubmission(currentState, args.data ?? {}, meta);
		}

		if (args.action === "widget_result") {
			if (!args.step) {
				return buildErrorResponse(
					'Missing "step" for widget_result action',
				);
			}

			// Merge widget result into state, then process
			const mergedData = args.widgetResult ?? {};
			return handleSubmission(currentState, mergedData, meta);
		}

		return buildErrorResponse(`Unknown action: "${args.action}"`);
	}

	return {
		id: config.id,
		title: config.title,
		description: fullDescription,

		async register(server: McpServer): Promise<void> {
			server.registerTool(
				config.id,
				{
					title: config.title,
					description: fullDescription,
					inputSchema,
					annotations: config.annotations,
				},
				(async (args: DynamicFlowToolInput, extra: unknown) => {
					const requestExtra = extra as RequestHandlerExtra<
						ServerRequest,
						ServerNotification
					>;
					const _meta: Record<string, unknown> =
						requestExtra._meta ?? {};

					const result = await handleToolCall(args, _meta);

					return {
						content: [
							{ type: "text" as const, text: result.text },
						],
						structuredContent: result.data,
						_meta: {
							...(result.widgetMeta ?? {}),
							..._meta,
						},
					};
				}) as unknown as ToolCallback<typeof inputSchema>,
			);
		},
	};
}
