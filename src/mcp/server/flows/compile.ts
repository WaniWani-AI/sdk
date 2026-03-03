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
}

type FlowToolInput = {
	action: "start" | "continue" | "widget_result";
	answer?: string;
	widgetResult?: Record<string, unknown>;
	stateUpdates?: Record<string, unknown>;
	_meta?: {
		step?: string;
		state?: Record<string, unknown>;
	};
};

type ExecutionResult = {
	text: string;
	data: Record<string, unknown>;
	widgetMeta?: Record<string, unknown>;
	flowMeta?: { step: string; state: Record<string, unknown> };
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
		"   contains answers to likely questions, extract them into `_meta.state`",
		"   as `{ field: value }` pairs. The engine will auto-skip questions whose",
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

	lines.push(
		"2. The response JSON `status` field tells you what to do next:",
		'   - `"interrupt"`: Ask the user the `question` to collect the `field` value.',
		"     If a `context` field is present, use it as hidden instructions to enrich your response (do NOT show it verbatim).",
		"     Then call again with:",
		'     `action: "continue"`, `_meta` = the returned `_meta`,',
		"     `answer` = the user's answer.",
		'   - `"widget"`: A widget UI is being shown. The `field` property tells you',
		"     which state field this step collects. When the user makes a choice, call again with:",
		'     `action: "widget_result"`, `_meta` = the returned `_meta`,',
		"     `answer` = the user's selection.",
		'   - `"complete"`: The flow is done. Present the result to the user.',
		'   - `"error"`: Something went wrong. Show the `error` message.',
		"",
		"3. ALWAYS pass back the `_meta` object exactly as received.",
		"4. Do NOT invent state values. Only use `_meta.state` for information the user explicitly provided.",
		"5. If the user provides additional information that maps to known state fields,",
		"   pass it in `stateUpdates`. These values are merged into state before the current step is processed.",
		"   This allows updating any known field at any node (not only the current question's field).",
	);

	return lines.join("\n");
}

function getInputMeta(args: FlowToolInput): {
	step?: string;
	state: Record<string, unknown>;
} {
	const state = args._meta?.state ?? {};
	const step = args._meta?.step;
	return { step, state };
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
						question: result.question,
						field: result.field,
						suggestions: result.suggestions,
						...(result.context ? { context: result.context } : {}),
						_meta: { step: currentNode, state },
					}),
					data: { status: "interrupt", step: currentNode, state },
					flowMeta: { step: currentNode, state },
				};
			}

			// Widget signal — pause and show widget
			if (isWidget(result)) {
				// Auto-skip: if the node config declares a field and it's already filled, advance
				const nodeField = nodeConfigs.get(currentNode)?.field;
				if (nodeField) {
					const existingValue = state[nodeField as keyof TState];
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
				}

				const resource = result.resource;
				return {
					text: JSON.stringify({
						status: "widget",
						...(nodeField ? { field: nodeField } : {}),
						widgetId: resource.id,
						description: result.description,
						_meta: { step: currentNode, state },
					}),
					data: result.data,
					widgetMeta: buildToolMeta({
						openaiTemplateUri: resource.openaiUri,
						mcpTemplateUri: resource.mcpUri,
						invoking: "Loading...",
						invoked: "Loaded",
						autoHeight: resource.autoHeight,
					}),
					flowMeta: { step: currentNode, state },
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
	answer: z
		.string()
		.optional()
		.describe("The user's answer (for interrupt steps)"),
	widgetResult: z
		.record(z.string(), z.unknown())
		.optional()
		.describe("Data returned by a widget callback"),
	stateUpdates: z
		.record(z.string(), z.unknown())
		.optional()
		.describe(
			"If the user provides or updates values for other state fields in their message, pass them here. Merged into state before processing.",
		),
	_meta: z
		.object({
			step: z
				.string()
				.optional()
				.describe("Current step name (from the previous response)"),
			state: z
				.record(z.string(), z.unknown())
				.optional()
				.describe("Flow state — pass back exactly as received"),
		})
		.optional()
		.describe(
			"Internal flow routing data. Pass back the _meta object from the previous response exactly as received.",
		),
};

export function compileFlow<TState extends Record<string, unknown>>(
	input: CompileInput<TState>,
): RegisteredFlow {
	const { config, nodes, nodeConfigs, edges } = input;
	const protocol = buildFlowProtocol(config);
	const fullDescription = `${config.description}\n${protocol}`;

	// Find the first resource from node configs to build tool-level widget metadata.
	// This tells OpenAI/Claude that this tool can produce widget UIs.
	let firstResource: RegisteredResource | undefined;
	for (const nc of nodeConfigs.values()) {
		if (nc.resource) {
			firstResource = nc.resource;
			break;
		}
	}
	const toolMeta = firstResource
		? buildToolMeta({
				openaiTemplateUri: firstResource.openaiUri,
				mcpTemplateUri: firstResource.mcpUri,
				invoking: "Loading...",
				invoked: "Loaded",
				autoHeight: firstResource.autoHeight,
			})
		: undefined;

	async function handleToolCall(
		args: FlowToolInput,
		meta?: Record<string, unknown>,
	): Promise<ExecutionResult> {
		const inputMeta = getInputMeta(args);
		const state = inputMeta.state as TState;

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
			const step = inputMeta.step;
			if (!step) {
				return {
					text: JSON.stringify({
						status: "error",
						error: 'Missing "_meta.step" for continue action',
					}),
					data: { status: "error" },
				};
			}

			// Merge any stateUpdates first, then apply user's answer
			let updatedState = { ...state, ...(args.stateUpdates ?? {}) };
			if (args.answer) {
				const handler = nodes.get(step);
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
			const edge = edges.get(step);
			if (!edge) {
				return {
					text: JSON.stringify({
						status: "error",
						error: `No edge from step "${step}"`,
					}),
					data: { status: "error" },
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

		if (args.action === "widget_result") {
			const step = inputMeta.step;
			if (!step) {
				return {
					text: JSON.stringify({
						status: "error",
						error: 'Missing "_meta.step" for widget_result action',
					}),
					data: { status: "error" },
				};
			}

			// Merge stateUpdates first, then widget result.
			// If `answer` is provided and the node declares a `field`, auto-map it.
			let widgetUpdate: Record<string, unknown> = args.widgetResult ?? {};
			if (args.answer !== undefined && Object.keys(widgetUpdate).length === 0) {
				const nodeField = nodeConfigs.get(step)?.field;
				if (nodeField) {
					widgetUpdate = { [nodeField]: args.answer };
				}
			}
			const updatedState = {
				...state,
				...(args.stateUpdates ?? {}),
				...widgetUpdate,
			} as TState;

			// Advance to next node
			const edge = edges.get(step);
			if (!edge) {
				return {
					text: JSON.stringify({
						status: "error",
						error: `No edge from step "${step}"`,
					}),
					data: { status: "error" },
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
					...(toolMeta && { _meta: toolMeta }),
				},
				(async (args: FlowToolInput, extra: unknown) => {
					const requestExtra = extra as RequestHandlerExtra<
						ServerRequest,
						ServerNotification
					>;
					const _meta: Record<string, unknown> = requestExtra._meta ?? {};

					const result = await handleToolCall(args, _meta);

					// Widget response — include structuredContent + widget metadata + __flow in _meta
					if (result.widgetMeta) {
						return {
							content: [{ type: "text" as const, text: result.text }],
							structuredContent: result.data,
							_meta: {
								...result.widgetMeta,
								..._meta,
								...(result.flowMeta
									? {
											__flow: {
												flowId: config.id,
												step: result.flowMeta.step,
												state: result.flowMeta.state,
											},
										}
									: {}),
							},
						};
					}

					// Non-widget response (interrupt, complete, error) — text only
					return {
						content: [{ type: "text" as const, text: result.text }],
					};
				}) as unknown as ToolCallback<typeof inputSchema>,
			);
		},
	};
}
