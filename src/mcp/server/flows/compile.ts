import type { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type {
	ServerNotification,
	ServerRequest,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { buildToolMeta } from "../resources/meta";
import type { RegisteredResource } from "../resources/types";
import type {
	Edge,
	FlowConfig,
	McpServer,
	NodeConfig,
	NodeHandler,
	RegisteredFlow,
} from "./@types";
import { END, isInterrupt, isWidget, START } from "./@types";

// ============================================================================
// Types
// ============================================================================

interface CompileInput<TState extends Record<string, unknown>> {
	config: FlowConfig;
	nodes: Map<string, NodeHandler<TState>>;
	nodeConfigs: Map<string, NodeConfig<TState>>;
	edges: Map<string, Edge<TState>>;
	/** Widget resources declared in declarative widget nodes — used for tool-level widget metadata */
	resources: RegisteredResource[];
}

type FlowToolInput = {
	action: "start" | "continue";
	stateUpdates?: Record<string, unknown>;
	_meta?: {
		flow?: {
			step?: string;
			state?: Record<string, unknown>;
			field?: string;
			widgetId?: string;
			/** All valid flow step names for this flow definition */
			stepNames?: string[];
			/** Step names valid for the next continue call (usually a single step) */
			resumeSteps?: string[];
			/** Cached interrupt questions from the previous response — used to avoid re-executing the handler */
			questions?: Array<{
				question: string;
				field: string;
				suggestions?: string[];
				context?: string;
			}>;
			/** Cached overall interrupt context */
			interruptContext?: string;
		};
	};
};

type FlowRoutingInputMeta = NonNullable<
	NonNullable<FlowToolInput["_meta"]>["flow"]
>;

type FlowPayload = {
	status: "widget" | "interrupt" | "complete" | "error";
	[key: string]: unknown;
};

type ExecutionResult = {
	payload: FlowPayload;
	data?: Record<string, unknown>;
	widgetMeta?: Record<string, unknown>;
	flowMeta?: {
		step?: string;
		state: Record<string, unknown>;
		field?: string;
		widgetId?: string;
		/** Cached interrupt questions — avoids re-executing the handler on partial answers */
		questions?: Array<{
			question: string;
			field: string;
			suggestions?: string[];
			context?: string;
		}>;
		/** Cached overall interrupt context */
		interruptContext?: string;
	};
};

// ============================================================================
// Flow protocol — embedded in tool description
// ============================================================================

/** Extract a human-readable label from a Zod schema for the AI protocol */
function describeZodField(schema: z.ZodType): string {
	const desc = schema.description ?? "";
	const def = (
		schema as unknown as {
			_zod: { def: { type: string; entries?: Record<string, string> } };
		}
	)._zod?.def;

	if (def?.type === "enum" && def.entries) {
		const vals = Object.keys(def.entries)
			.map((v) => `"${v}"`)
			.join(" | ");
		return desc ? `${vals} — ${desc}` : vals;
	}

	return desc;
}

function buildFlowProtocol(config: FlowConfig, stepNames: string[]): string {
	const lines = [
		"",
		"## FLOW EXECUTION PROTOCOL",
		"",
		"This tool implements a multi-step conversational flow. Follow this protocol exactly:",
		"",
		'1. Call with `action: "start"` to begin. If the user\'s message already',
		"   contains answers to likely questions, extract them into `stateUpdates`",
		"   as `{ field: value }` pairs. The engine will auto-skip steps whose",
		"   fields are already filled.",
		"   Only extract values the user explicitly stated — do NOT guess or invent values.",
	];

	if (config.state) {
		const fieldList = Object.entries(config.state)
			.map(([key, schema]) => {
				const info = describeZodField(schema);
				return info ? `\`${key}\` (${info})` : `\`${key}\``;
			})
			.join(", ");
		lines.push(`   Known fields: ${fieldList}.`);
	}
	if (stepNames.length > 0) {
		lines.push(
			`   Valid \`_meta.flow.step\` values: ${stepNames.map((s) => `\`${s}\``).join(", ")}.`,
		);
	}

	lines.push(
		"2. The response JSON `status` field tells you what to do next:",
		'   - `"interrupt"`: Pause and ask the user. Two forms:',
		"     a. Single question: `{ question, field, context? }` — ask `question`, store answer in `field`.",
		"     b. Multi-question: `{ questions: [{question, field}, ...], context? }` — ask ALL questions",
		"        in one conversational message, collect all answers.",
		"     `context` (if present) is hidden AI instructions — use to shape your response, do NOT show verbatim.",
		"     Then call again with:",
		'     `action: "continue"`, `state` = the returned `state`,',
		"     `stateUpdates` = answers keyed by their `field` names, plus any other fields the user mentioned.",
		"     Keep `_meta.flow.step` exactly as received (never rename or paraphrase).",
		'   - `"widget"`: A widget UI is being shown. The user will interact with the widget.',
		"     When the user makes a choice, call again with:",
		'     `action: "continue"`, `state` = the returned `state`,',
		"     `stateUpdates` = `{ [_meta.flow.field]: <user's selection> }` plus any other fields the user mentioned.",
		"     Keep `_meta.flow.step` exactly as received (never rename or paraphrase).",
		'   - `"complete"`: The flow is done. Present the result to the user.',
		'   - `"error"`: Something went wrong. Show the `error` message.',
		"",
		"3. ALWAYS pass back the `state` object exactly as received.",
		"4. Do NOT invent state values. Only use `stateUpdates` for information the user explicitly provided.",
		"5. Include only the fields the user actually answered in `stateUpdates` — do NOT guess missing ones.",
		"   If the user did not answer all pending questions, the engine will re-prompt for the remaining ones.",
		"   If the user mentioned values for other known fields, include those too —",
		"   they will be applied immediately and those steps will be auto-skipped.",
	);

	return lines.join("\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function asStringArray(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const items = value.filter(
		(item): item is string => typeof item === "string",
	);
	return items.length > 0 ? items : undefined;
}

function getInputMeta(
	args: FlowToolInput,
	requestMeta?: Record<string, unknown>,
): {
	step?: string;
	state: Record<string, unknown>;
	field?: string;
	widgetId?: string;
	stepNames?: string[];
	resumeSteps?: string[];
	questions?: Array<{
		question: string;
		field: string;
		suggestions?: string[];
		context?: string;
	}>;
	interruptContext?: string;
} {
	const argsFlow = args._meta?.flow;
	const requestFlow = isRecord(requestMeta?.flow)
		? (requestMeta?.flow as FlowRoutingInputMeta)
		: undefined;

	const argsState = argsFlow?.state ?? {};
	const requestState = requestFlow?.state ?? {};

	const state = {
		...(isRecord(requestState) ? requestState : {}),
		...(isRecord(argsState) ? argsState : {}),
	};
	const step = argsFlow?.step ?? requestFlow?.step;
	const field = argsFlow?.field ?? requestFlow?.field;
	const widgetId = argsFlow?.widgetId ?? requestFlow?.widgetId;
	const stepNames =
		argsFlow?.stepNames ?? asStringArray(requestFlow?.stepNames);
	const resumeSteps =
		argsFlow?.resumeSteps ?? asStringArray(requestFlow?.resumeSteps);
	const questions = argsFlow?.questions ?? requestFlow?.questions;
	const interruptContext =
		argsFlow?.interruptContext ?? requestFlow?.interruptContext;
	return {
		step,
		state,
		field,
		widgetId,
		stepNames,
		resumeSteps,
		questions,
		interruptContext,
	};
}

// ============================================================================
// Edge resolution
// ============================================================================

async function resolveNextNode<TState extends Record<string, unknown>>(
	edge: Edge<TState>,
	state: Partial<TState>,
): Promise<string> {
	if (edge.type === "direct") return edge.to;
	return edge.condition(state);
}

// ============================================================================
// Helpers
// ============================================================================

/** Check whether a state value counts as "filled" (not empty/missing). */
function isFilled(v: unknown): boolean {
	return v !== undefined && v !== null && v !== "";
}

// ============================================================================
// Interrupt result builder
// ============================================================================

type InterruptQuestionData = {
	question: string;
	field: string;
	suggestions?: string[];
	context?: string;
};

/**
 * Build an interrupt ExecutionResult from a list of questions and current state.
 * Filters out already-answered questions and caches the full question list in
 * flowMeta so partial-answer continues can filter without re-executing the handler.
 *
 * Returns `null` when all questions are already filled (caller should advance).
 */
function buildInterruptResult<TState extends Record<string, unknown>>(
	questions: InterruptQuestionData[],
	context: string | undefined,
	currentNode: string,
	state: TState,
): ExecutionResult | null {
	// All filled — caller should advance to the next node
	if (questions.every((q) => isFilled(state[q.field as keyof TState]))) {
		return null;
	}

	// Filter out questions whose fields are already answered
	const unanswered = questions.filter(
		(q) => !isFilled(state[q.field as keyof TState]),
	);

	// Single-question shorthand: unwrap for cleaner AI payload
	const isSingle = unanswered.length === 1;
	const q0 = unanswered[0];
	const payload =
		isSingle && q0
			? {
					status: "interrupt" as const,
					question: q0.question,
					field: q0.field,
					...(q0.suggestions ? { suggestions: q0.suggestions } : {}),
					...(q0.context || context ? { context: q0.context ?? context } : {}),
				}
			: {
					status: "interrupt" as const,
					questions: unanswered,
					...(context ? { context } : {}),
				};

	return {
		payload,
		flowMeta: {
			step: currentNode,
			state,
			...(isSingle && q0 ? { field: q0.field } : {}),
			// Cache the full question list so partial-answer continues
			// can filter without re-executing the node handler.
			questions,
			...(context ? { interruptContext: context } : {}),
		},
	};
}

// ============================================================================
// Execution engine
// ============================================================================

async function executeFrom<TState extends Record<string, unknown>>(
	startNodeName: string,
	startState: TState,
	nodes: Map<string, NodeHandler<TState>>,
	nodeConfigs: Map<string, NodeConfig<TState>>,
	edges: Map<string, Edge<TState>>,
	meta?: Record<string, unknown>,
): Promise<ExecutionResult> {
	let currentNode = startNodeName;
	let state = { ...startState };

	// Safety limit to prevent infinite loops
	const MAX_ITERATIONS = 50;
	let iterations = 0;

	while (iterations++ < MAX_ITERATIONS) {
		// Reached END
		if (currentNode === END) {
			return {
				payload: { status: "complete" },
				flowMeta: { state },
			};
		}

		const handler = nodes.get(currentNode);
		if (!handler) {
			return {
				payload: {
					status: "error",
					error: `Unknown node: "${currentNode}"`,
				},
			};
		}

		try {
			const result = await handler(state, meta);

			// Interrupt signal — pause and ask the user one or more questions
			if (isInterrupt(result)) {
				const interruptResult = buildInterruptResult(
					result.questions,
					result.context,
					currentNode,
					state,
				);
				if (interruptResult) return interruptResult;

				// All questions filled — auto-skip to next node
				const edge = edges.get(currentNode);
				if (!edge) {
					return {
						payload: {
							status: "error",
							error: `No outgoing edge from node "${currentNode}"`,
						},
					};
				}
				currentNode = await resolveNextNode(edge, state);
				continue;
			}

			// Widget signal — pause and show widget
			if (isWidget(result)) {
				// Auto-skip: use field from the signal, fall back to nodeConfig
				const widgetField = result.field ?? nodeConfigs.get(currentNode)?.field;
				if (widgetField) {
					if (isFilled(state[widgetField as keyof TState])) {
						const edge = edges.get(currentNode);
						if (!edge) {
							return {
								payload: {
									status: "error",
									error: `No outgoing edge from node "${currentNode}"`,
								},
							};
						}
						currentNode = await resolveNextNode(edge, state);
						continue;
					}
				}

				const resource = result.resource;
				return {
					payload: {
						status: "widget",
						description: result.description,
					},
					data: result.data,
					widgetMeta: buildToolMeta({
						openaiTemplateUri: resource.openaiUri,
						mcpTemplateUri: resource.mcpUri,
						invoking: "Loading...",
						invoked: "Loaded",
						autoHeight: resource.autoHeight,
					}),
					flowMeta: {
						step: currentNode,
						state,
						field: widgetField,
						widgetId: resource.id,
					},
				};
			}

			// Action node — merge state and auto-advance
			state = { ...state, ...result } as TState;

			const edge = edges.get(currentNode);
			if (!edge) {
				return {
					payload: {
						status: "error",
						error: `No outgoing edge from node "${currentNode}"`,
					},
				};
			}
			currentNode = await resolveNextNode(edge, state);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return {
				payload: { status: "error", error: message },
				flowMeta: { step: currentNode, state },
			};
		}
	}

	return {
		payload: {
			status: "error",
			error: "Flow exceeded maximum iterations (possible infinite loop)",
		},
	};
}

// ============================================================================
// Compile
// ============================================================================

function createInputSchema(stepNames: string[]) {
	const stepEnumSchema =
		stepNames.length > 0
			? z.enum([stepNames[0] as string, ...stepNames.slice(1)])
			: z.string();
	const stepDescription =
		stepNames.length > 0
			? `Current step name (from previous response). Must be one of: ${stepNames.join(", ")}`
			: "Current step name (from the previous response)";

	const flowSchema = z.object({
		step: stepEnumSchema.optional().describe(stepDescription),
		state: z
			.record(z.string(), z.unknown())
			.optional()
			.describe("Flow state — pass back exactly as received"),
		field: z.string().optional(),
		widgetId: z.string().optional(),
		stepNames: z
			.array(stepEnumSchema)
			.optional()
			.describe(
				"All valid flow step names for this flow. Treat this as an enum list.",
			),
		resumeSteps: z
			.array(stepEnumSchema)
			.optional()
			.describe(
				"Valid step names for the next continue call. Prefer these when provided.",
			),
		questions: z
			.array(
				z.object({
					question: z.string(),
					field: z.string(),
					suggestions: z.array(z.string()).optional(),
					context: z.string().optional(),
				}),
			)
			.optional(),
		interruptContext: z.string().optional(),
	});

	return {
		action: z
			.enum(["start", "continue"])
			.describe(
				'"start" to begin the flow, "continue" to resume after a pause (interrupt or widget)',
			),
		stateUpdates: z
			.record(z.string(), z.unknown())
			.optional()
			.describe(
				"State field values to set before processing the next node. Use this to pass the user's answer (keyed by the field name from _meta.flow.field) and any other values the user mentioned.",
			),
		_meta: z
			.object({
				flow: flowSchema
					.optional()
					.describe("Flow routing data. Pass back exactly as received."),
			})
			.optional()
			.describe(
				"Internal flow routing data. Pass back the _meta object from the previous response exactly as received.",
			),
	};
}

export function compileFlow<TState extends Record<string, unknown>>(
	input: CompileInput<TState>,
): RegisteredFlow {
	const { config, nodes, nodeConfigs, edges, resources } = input;
	const allStepNames = Array.from(nodes.keys());
	const allStepNamesSet = new Set(allStepNames);
	const toolInputSchema = createInputSchema(allStepNames);
	const protocol = buildFlowProtocol(config, allStepNames);
	const fullDescription = `${config.description}\n${protocol}`;

	// Signal that this tool CAN produce widgets, but don't bake in a fixed
	// output template URI.  Flows are multi-step — the correct template is
	// included per-response when the flow reaches a widget node.  Setting a
	// fixed `openai/outputTemplate` at registration causes hosts (e.g.
	// ChatGPT) to render the widget on first invocation, before the flow
	// has progressed to the widget step.
	const firstResource = resources[0];
	const toolMeta = firstResource
		? buildToolMeta({
				openaiTemplateUri: "",
				mcpTemplateUri: "",
				invoking: "Loading...",
				invoked: "Loaded",
				autoHeight: firstResource.autoHeight,
			})
		: undefined;
	async function handleToolCall(
		args: FlowToolInput,
		meta?: Record<string, unknown>,
	): Promise<ExecutionResult> {
		// ChatGPT puts flow routing in protocol-level params._meta.flow for continue calls.
		// For start, ignore protocol-level flow metadata to avoid stale-state leakage.
		const inputMeta = getInputMeta(
			args,
			args.action === "continue" ? meta : undefined,
		);
		const state = inputMeta.state as TState;

		if (args.action === "start") {
			const startEdge = edges.get(START);
			if (!startEdge) {
				return {
					payload: {
						status: "error",
						error: "No start edge",
					},
				};
			}

			// Merge pre-filled answers and any stateUpdates
			const startState = {
				...state,
				...(args.stateUpdates ?? {}),
			} as TState;

			const firstNode = await resolveNextNode(startEdge, startState);
			return executeFrom(
				firstNode,
				startState,
				nodes,
				nodeConfigs,
				edges,
				meta,
			);
		}

		if (args.action === "continue") {
			let step = inputMeta.step;
			if (step && !allStepNamesSet.has(step)) {
				const validResumeSteps =
					inputMeta.resumeSteps?.filter((candidate) =>
						allStepNamesSet.has(candidate),
					) ?? [];
				if (validResumeSteps.length === 1) {
					step = validResumeSteps[0];
				}
			}
			if (!step) {
				return {
					payload: {
						status: "error",
						error: 'Missing "_meta.flow.step" for continue action',
					},
				};
			}
			if (!allStepNamesSet.has(step)) {
				return {
					payload: {
						status: "error",
						error: `Invalid "_meta.flow.step": "${step}". Expected one of: ${allStepNames.join(", ")}`,
					},
				};
			}

			const updatedState = {
				...state,
				...(args.stateUpdates ?? {}),
			} as TState;

			// If cached interrupt questions exist, check for unanswered questions
			// without re-executing the node handler (avoids side-effect replay).
			if (inputMeta.questions) {
				const interruptResult = buildInterruptResult(
					inputMeta.questions,
					inputMeta.interruptContext,
					step,
					updatedState,
				);
				if (interruptResult) return interruptResult;
				// All questions answered — fall through to advance
			}

			// Advance to next node when: all cached questions are answered, or
			// this is a widget continue (widgets never have cached questions and
			// re-executing the handler would cause a stuck loop for field-less widgets).
			// Otherwise the AI may have dropped _meta.flow.questions — re-execute
			// from the current step so the handler can re-check unanswered questions.
			if (inputMeta.questions || inputMeta.widgetId) {
				const edge = edges.get(step);
				if (!edge) {
					return {
						payload: {
							status: "error",
							error: `No edge from step "${step}"`,
						},
					};
				}
				const nextNode = await resolveNextNode(edge, updatedState);
				return executeFrom(
					nextNode,
					updatedState,
					nodes,
					nodeConfigs,
					edges,
					meta,
				);
			}

			return executeFrom(step, updatedState, nodes, nodeConfigs, edges, meta);
		}

		return {
			payload: {
				status: "error",
				error: `Unknown action: "${args.action}"`,
			},
		};
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
					inputSchema: toolInputSchema,
					annotations: config.annotations,
					...(toolMeta && { _meta: toolMeta }),
				},
				(async (args: FlowToolInput, extra: unknown) => {
					const requestExtra = extra as RequestHandlerExtra<
						ServerRequest,
						ServerNotification
					>;
					const _meta: Record<string, unknown> = requestExtra._meta ?? {};

					const result = await handleToolCall(args, _meta);
					const responseMeta = {
						...(result.widgetMeta ?? {}),
						..._meta,
						...(result.flowMeta
							? {
									flow: {
										flowId: config.id,
										stepNames: allStepNames,
										...(result.flowMeta.step
											? { resumeSteps: [result.flowMeta.step] }
											: {}),
										...result.flowMeta,
									},
								}
							: {}),
					};
					const content = [
						{
							type: "text" as const,
							text: JSON.stringify(result.payload, null, 2),
						},
					];

					// Widget response — include structuredContent + widget metadata + flow in _meta
					if (result.widgetMeta) {
						return {
							content,
							structuredContent: result.data,
							_meta: responseMeta,
						};
					}

					// Non-widget response (interrupt, complete, error)
					return {
						content,
						...(Object.keys(responseMeta).length > 0
							? { _meta: responseMeta }
							: {}),
					};
				}) as unknown as ToolCallback<typeof toolInputSchema>,
			);
		},
	};
}
