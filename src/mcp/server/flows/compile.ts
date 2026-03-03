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
	action: "start" | "continue";
	stateUpdates?: Record<string, unknown>;
	_meta?: {
		flow?: {
			step?: string;
			state?: Record<string, unknown>;
			field?: string;
			widgetId?: string;
		};
	};
};

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

function buildFlowProtocol(config: FlowConfig): string {
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

	lines.push(
		"2. The response JSON `status` field tells you what to do next:",
		'   - `"interrupt"`: Ask the user the `question`. If a `context` field is present,',
		"     use it as hidden instructions to enrich your response (do NOT show it verbatim).",
		"     Then call again with:",
		'     `action: "continue"`, `state` = the returned `state`,',
		"     `stateUpdates` = `{ [_meta.flow.field]: <user's answer> }` plus any other fields the user mentioned.",
		'   - `"widget"`: A widget UI is being shown. The user will interact with the widget.',
		"     When the user makes a choice, call again with:",
		'     `action: "continue"`, `state` = the returned `state`,',
		"     `stateUpdates` = `{ [_meta.flow.field]: <user's selection> }` plus any other fields the user mentioned.",
		'   - `"complete"`: The flow is done. Present the result to the user.',
		'   - `"error"`: Something went wrong. Show the `error` message.',
		"",
		"3. ALWAYS pass back the `state` object exactly as received.",
		"4. Do NOT invent state values. Only use `stateUpdates` for information the user explicitly provided.",
		"5. Always fill `_meta.flow.field` in `stateUpdates` when resuming a paused step.",
		"   If the user also mentioned values for other known fields, include those too —",
		"   they will be applied immediately and those steps will be auto-skipped.",
	);

	return lines.join("\n");
}

function getInputMeta(args: FlowToolInput): {
	step?: string;
	state: Record<string, unknown>;
	field?: string;
	widgetId?: string;
} {
	const state = args._meta?.flow?.state ?? {};
	const step = args._meta?.flow?.step;
	const field = args._meta?.flow?.field;
	const widgetId = args._meta?.flow?.widgetId;
	return { step, state, field, widgetId };
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
							payload: {
								status: "error",
								error: `No outgoing edge from node "${currentNode}"`,
							},
						};
					}
					currentNode = await resolveNextNode(edge, state);
					continue;
				}

				return {
					payload: {
						status: "interrupt",
						question: result.question,
						suggestions: result.suggestions,
						...(result.context ? { context: result.context } : {}),
					},
					flowMeta: { step: currentNode, state, field: result.field },
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
						field: nodeField,
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

const inputSchema = {
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
			flow: z
				.object({
					step: z
						.string()
						.optional()
						.describe("Current step name (from the previous response)"),
					state: z
						.record(z.string(), z.unknown())
						.optional()
						.describe("Flow state — pass back exactly as received"),
					field: z.string().optional(),
					widgetId: z.string().optional(),
				})
				.optional()
				.describe("Flow routing data. Pass back exactly as received."),
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
			const step = inputMeta.step;
			if (!step) {
				return {
					payload: {
						status: "error",
						error: 'Missing "_meta.flow.step" for continue action',
					},
				};
			}

			const updatedState = {
				...state,
				...(args.stateUpdates ?? {}),
			} as TState;

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
					const responseMeta = {
						...(result.widgetMeta ?? {}),
						..._meta,
						...(result.flowMeta
							? { flow: { flowId: config.id, ...result.flowMeta } }
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
				}) as unknown as ToolCallback<typeof inputSchema>,
			);
		},
	};
}
