import type { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type {
	ServerNotification,
	ServerRequest,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type {
	Edge,
	FlowConfig,
	McpServer,
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
	edges: Map<string, Edge<TState>>;
}

type FlowToolInput = {
	action: "start" | "continue" | "widget_result";
	step?: string;
	state?: Record<string, unknown>;
	answer?: string;
	widgetResult?: Record<string, unknown>;
	initialState?: Record<string, unknown>;
};

type ExecutionResult = {
	text: string;
	data: Record<string, unknown>;
	widgetMeta?: Record<string, unknown>;
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

function buildFlowProtocol(config: FlowConfig): string {
	const lines = [
		"",
		"## FLOW EXECUTION PROTOCOL",
		"",
		"This tool implements a multi-step conversational flow. Follow this protocol exactly:",
		"",
		'1. Call with `action: "start"` to begin. If the user\'s message already',
		"   contains answers to likely questions, extract them into `initialState`",
		"   as `{ field: value }` pairs. The engine will auto-skip questions whose",
		"   fields are already filled.",
		"   Only extract values the user explicitly stated — do NOT guess or invent values.",
	];

	if (config.fields) {
		const fieldList = Object.entries(config.fields)
			.map(([key, schema]) => {
				const info = describeZodField(schema);
				return info ? `\`${key}\` (${info})` : `\`${key}\``;
			})
			.join(", ");
		lines.push(`   Known fields: ${fieldList}.`);
	}

	lines.push(
		"2. The response JSON `status` field tells you what to do next:",
		'   - `"interrupt"`: Ask the user the `question`. If a `context` field is present,',
		"     use it as hidden instructions to enrich your response (do NOT show it verbatim).",
		"     Then call again with:",
		'     `action: "continue"`, `step` = the returned `step`, `state` = the returned `state`,',
		"     `answer` = the user's answer.",
		'   - `"widget"`: A widget UI is being shown. Do NOT call this tool again — the widget handles the callback.',
		'   - `"complete"`: The flow is done. Present the result to the user.',
		'   - `"error"`: Something went wrong. Show the `error` message.',
		"",
		"3. ALWAYS pass back the `state` object exactly as received.",
		"4. Do NOT invent state values. Only use `initialState` for information the user explicitly provided.",
	);

	return lines.join("\n");
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
// Execution engine
// ============================================================================

async function executeFrom<TState extends Record<string, unknown>>(
	startNodeName: string,
	initialState: TState,
	nodes: Map<string, NodeHandler<TState>>,
	edges: Map<string, Edge<TState>>,
	flowId: string,
	meta?: Record<string, unknown>,
): Promise<ExecutionResult> {
	let currentNode = startNodeName;
	let state = { ...initialState };

	// Safety limit to prevent infinite loops
	const MAX_ITERATIONS = 50;
	let iterations = 0;

	while (iterations++ < MAX_ITERATIONS) {
		// Reached END
		if (currentNode === END) {
			return {
				text: JSON.stringify({
					status: "complete",
					state,
				}),
				data: { status: "complete", state },
			};
		}

		const handler = nodes.get(currentNode);
		if (!handler) {
			return {
				text: JSON.stringify({
					status: "error",
					error: `Unknown node: "${currentNode}"`,
				}),
				data: { status: "error" },
			};
		}

		try {
			const result = await handler(state, meta);

			// Interrupt signal — pause and ask the user
			if (isInterrupt(result)) {
				// Auto-skip: if the field already has a value in state, advance
				const existingValue = state[result.field as keyof TState];
				if (
					existingValue !== undefined &&
					existingValue !== null &&
					existingValue !== ""
				) {
					const edge = edges.get(currentNode);
					if (!edge) {
						return {
							text: JSON.stringify({
								status: "error",
								error: `No outgoing edge from node "${currentNode}"`,
							}),
							data: { status: "error" },
						};
					}
					currentNode = await resolveNextNode(edge, state);
					continue;
				}

				return {
					text: JSON.stringify({
						status: "interrupt",
						step: currentNode,
						question: result.question,
						field: result.field,
						suggestions: result.suggestions,
						...(result.context ? { context: result.context } : {}),
						state,
					}),
					data: { status: "interrupt", step: currentNode, state },
				};
			}

			// Widget signal — pause and show widget
			if (isWidget(result)) {
				const resource = result.resource;
				return {
					text: JSON.stringify({
						status: "widget",
						step: currentNode,
						widgetId: resource.id,
						description: result.description,
						state,
					}),
					data: {
						...result.data,
						__flow: {
							flowId,
							step: currentNode,
							state,
						},
					},
					widgetMeta: {
						"openai/outputTemplate": resource.openaiUri,
						"openai/widgetAccessible": true,
						"openai/resultCanProduceWidget": true,
						ui: {
							resourceUri: resource.mcpUri,
						},
					},
				};
			}

			// Action node — merge state and auto-advance
			state = { ...state, ...result } as TState;

			const edge = edges.get(currentNode);
			if (!edge) {
				return {
					text: JSON.stringify({
						status: "error",
						error: `No outgoing edge from node "${currentNode}"`,
					}),
					data: { status: "error" },
				};
			}
			currentNode = await resolveNextNode(edge, state);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return {
				text: JSON.stringify({
					status: "error",
					step: currentNode,
					error: message,
					state,
				}),
				data: { status: "error", error: message },
			};
		}
	}

	return {
		text: JSON.stringify({
			status: "error",
			error: "Flow exceeded maximum iterations (possible infinite loop)",
		}),
		data: { status: "error" },
	};
}

// ============================================================================
// Compile
// ============================================================================

const inputSchema = {
	action: z
		.enum(["start", "continue", "widget_result"])
		.describe(
			'"start" to begin the flow, "continue" after the user answers a question, "widget_result" when a widget returns data',
		),
	step: z
		.string()
		.optional()
		.describe("Current step name (from the previous response)"),
	state: z
		.record(z.string(), z.unknown())
		.optional()
		.describe("Flow state — pass back exactly as received"),
	answer: z
		.string()
		.optional()
		.describe("The user's answer (for interrupt steps)"),
	widgetResult: z
		.record(z.string(), z.unknown())
		.optional()
		.describe("Data returned by a widget callback"),
	initialState: z
		.record(z.string(), z.unknown())
		.optional()
		.describe(
			'Pre-filled answers extracted from the user\'s message (only for action: "start")',
		),
};

export function compileFlow<TState extends Record<string, unknown>>(
	input: CompileInput<TState>,
): RegisteredFlow {
	const { config, nodes, edges } = input;
	const protocol = buildFlowProtocol(config);
	const fullDescription = `${config.description}\n${protocol}`;

	async function handleToolCall(
		args: FlowToolInput,
		meta?: Record<string, unknown>,
	): Promise<ExecutionResult> {
		const state = (args.state ?? {}) as TState;

		if (args.action === "start") {
			const startEdge = edges.get(START);
			if (!startEdge) {
				return {
					text: JSON.stringify({
						status: "error",
						error: "No start edge",
					}),
					data: { status: "error" },
				};
			}

			// Merge pre-filled answers from the user's initial message
			const startState = (
				args.initialState ? { ...state, ...args.initialState } : state
			) as TState;

			const firstNode = await resolveNextNode(startEdge, startState);
			return executeFrom(firstNode, startState, nodes, edges, config.id, meta);
		}

		if (args.action === "continue") {
			if (!args.step) {
				return {
					text: JSON.stringify({
						status: "error",
						error: 'Missing "step" for continue action',
					}),
					data: { status: "error" },
				};
			}

			// Apply user's answer to state using the field from the interrupt
			let updatedState = { ...state };
			if (args.answer) {
				const handler = nodes.get(args.step);
				if (handler) {
					try {
						const result = await handler(updatedState, meta);
						if (isInterrupt(result) && result.field) {
							updatedState = {
								...updatedState,
								[result.field]: args.answer,
							} as TState;
						}
					} catch {
						// If re-running the handler fails, still proceed with the answer
					}
				}
			}

			// Advance to next node
			const edge = edges.get(args.step);
			if (!edge) {
				return {
					text: JSON.stringify({
						status: "error",
						error: `No edge from step "${args.step}"`,
					}),
					data: { status: "error" },
				};
			}
			const nextNode = await resolveNextNode(edge, updatedState);
			return executeFrom(nextNode, updatedState, nodes, edges, config.id, meta);
		}

		if (args.action === "widget_result") {
			if (!args.step) {
				return {
					text: JSON.stringify({
						status: "error",
						error: 'Missing "step" for widget_result action',
					}),
					data: { status: "error" },
				};
			}

			// Merge widget result into state
			const updatedState = {
				...state,
				...(args.widgetResult ?? {}),
			} as TState;

			// Advance to next node
			const edge = edges.get(args.step);
			if (!edge) {
				return {
					text: JSON.stringify({
						status: "error",
						error: `No edge from step "${args.step}"`,
					}),
					data: { status: "error" },
				};
			}
			const nextNode = await resolveNextNode(edge, updatedState);
			return executeFrom(nextNode, updatedState, nodes, edges, config.id, meta);
		}

		return {
			text: JSON.stringify({
				status: "error",
				error: `Unknown action: "${args.action}"`,
			}),
			data: { status: "error" },
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
					inputSchema,
					annotations: config.annotations,
				},
				(async (args: FlowToolInput, extra: unknown) => {
					const requestExtra = extra as RequestHandlerExtra<
						ServerRequest,
						ServerNotification
					>;
					const _meta: Record<string, unknown> = requestExtra._meta ?? {};

					const result = await handleToolCall(args, _meta);

					return {
						content: [{ type: "text" as const, text: result.text }],
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
