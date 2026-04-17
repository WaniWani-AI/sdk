import type { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type {
	ServerNotification,
	ServerRequest,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { ScopedWaniWaniClient } from "../scoped-client";
import { extractScopedClient } from "../scoped-client";
import { extractSessionId } from "../utils";
import type {
	CompileInput,
	FlowToolHandler,
	FlowToolInput,
	McpServer,
	RegisteredFlow,
} from "./@types";
import { START } from "./@types";
import { executeFrom, resolveNextNode, type ValidateFn } from "./execute";
import { type FlowStore, WaniwaniFlowStore } from "./flow-store";
import { extractFlowGraph } from "./graph-extract";
import { deepMerge, expandDotPaths } from "./nested";
import { buildFlowProtocol } from "./protocol";

// ============================================================================
// Input schema
// ============================================================================

const inputSchema = {
	action: z
		.enum(["start", "continue"])
		.describe(
			'"start" to begin the flow, "continue" to resume after a pause (interrupt or widget)',
		),
	intent: z
		.string()
		.optional()
		.describe(
			'Required when action is "start". Provide a brief summary of the user\'s goal for this flow, including relevant prior context that led to triggering it, if available. Do not invent missing context.',
		),
	stateUpdates: z
		.record(z.string(), z.unknown())
		.optional()
		.describe(
			"State field values to set before processing the next node. Use this to pass the user's answer (keyed by the field name from the response) and any other values the user mentioned.",
		),
};

// ============================================================================
// Compile
// ============================================================================

export function compileFlow<TState extends Record<string, unknown>>(
	input: CompileInput<TState>,
): RegisteredFlow {
	const { config, nodes, edges } = input;
	const flowGraph = extractFlowGraph(config, nodes, edges, input.nodeOptions);
	const protocol = buildFlowProtocol(config);
	const fullDescription = `${config.description}\n${protocol}`;

	const store: FlowStore = input.store ?? new WaniwaniFlowStore();

	// Validator storage — populated when handlers return interrupts with validate functions.
	// Keyed by "nodeName:fieldName", persists across tool calls within the same server.
	const validators = new Map<string, ValidateFn>();

	async function handleToolCall(
		args: FlowToolInput,
		sessionId: string | undefined,
		meta?: Record<string, unknown>,
		waniwani?: ScopedWaniWaniClient,
	) {
		if (args.action === "start") {
			const intent =
				typeof args.intent === "string" ? args.intent.trim() : undefined;
			if (!intent) {
				return {
					content: {
						status: "error" as const,
						error:
							'Missing required "intent" for action "start". Include a brief summary of the user\'s goal for this flow and any relevant prior context that led to triggering it, if available.',
					},
				};
			}
			args.intent = intent;

			const startEdge = edges.get(START);
			if (!startEdge) {
				return {
					content: { status: "error" as const, error: "No start edge" },
				};
			}

			const startState = expandDotPaths(args.stateUpdates ?? {}) as TState;
			const firstNode = await resolveNextNode(startEdge, startState);
			return executeFrom(
				firstNode,
				startState,
				nodes,
				edges,
				validators,
				meta,
				waniwani,
				input.nodeOptions,
				config.id,
			);
		}

		if (args.action === "continue") {
			if (!sessionId) {
				return {
					content: {
						status: "error" as const,
						error: "No session ID available for continue action.",
					},
				};
			}

			let flowState: Awaited<ReturnType<typeof store.get>>;
			try {
				flowState = await store.get(sessionId);
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				return {
					content: {
						status: "error" as const,
						error: `Failed to load flow state (session "${sessionId}"): ${msg}`,
					},
				};
			}

			if (!flowState) {
				return {
					content: {
						status: "error" as const,
						error: `Flow state not found for session "${sessionId}". The flow may have expired.`,
					},
				};
			}

			const state = flowState.state as TState;
			const step = flowState.step;
			if (!step) {
				return {
					content: {
						status: "error" as const,
						error:
							'This flow has already completed. Use action "start" to begin a new flow.',
					},
				};
			}

			const updatedState = deepMerge(
				state as Record<string, unknown>,
				expandDotPaths(args.stateUpdates ?? {}),
			) as TState;

			// Widget continue: advance past the widget step (don't re-show it)
			if (flowState.widgetId) {
				const edge = edges.get(step);
				if (!edge) {
					return {
						content: {
							status: "error" as const,
							error: `No edge from step "${step}"`,
						},
					};
				}
				const nextNode = await resolveNextNode(edge, updatedState);
				return executeFrom(
					nextNode,
					updatedState,
					nodes,
					edges,
					validators,
					meta,
					waniwani,
					input.nodeOptions,
					config.id,
				);
			}

			// Interrupt continue: re-execute from current step.
			// The handler re-runs, filters answered questions, and runs
			// validators if all questions are filled.
			return executeFrom(
				step,
				updatedState,
				nodes,
				edges,
				validators,
				meta,
				waniwani,
				input.nodeOptions,
				config.id,
			);
		}

		return {
			content: {
				status: "error" as const,
				error: `Unknown action: "${args.action}"`,
			},
		};
	}

	const toolConfig = {
		title: config.title,
		description: fullDescription,
		inputSchema,
		annotations: config.annotations,
	};

	const toolHandler = (async (args: FlowToolInput, extra: unknown) => {
		const requestExtra = extra as RequestHandlerExtra<
			ServerRequest,
			ServerNotification
		>;
		const _meta: Record<string, unknown> = requestExtra._meta ?? {};
		const sessionId = extractSessionId(_meta);
		const waniwani = extractScopedClient(requestExtra);

		const result = await handleToolCall(args, sessionId, _meta, waniwani);

		// Persist flow state under session ID
		if (sessionId) {
			if (result.flowTokenContent && result.content.status !== "complete") {
				try {
					await store.set(sessionId, result.flowTokenContent);
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err);
					const errorContent = [
						{
							type: "text" as const,
							text: JSON.stringify(
								{
									status: "error",
									error: `Flow state failed to persist (session "${sessionId}"): ${msg}`,
								},
								null,
								2,
							),
						},
					];
					return {
						content: errorContent,
						_meta,
						isError: true,
					};
				}
			} else if (result.content.status === "complete") {
				// Clean up — flow is done, remove stale state so a subsequent
				// "continue" returns "not found" instead of a confusing step error.
				await store.delete(sessionId);
			}
		}

		const content = [
			{
				type: "text" as const,
				text: JSON.stringify(result.content, null, 2),
			},
		];

		return {
			content,
			_meta,
			...(result.content.status === "error" ? { isError: true } : {}),
		};
	}) satisfies ToolCallback<typeof inputSchema>;

	return {
		// MCP-compatible — server.registerTool(flow.name, flow.config, flow.handler)
		name: config.id,
		config: toolConfig,
		handler: toolHandler as unknown as FlowToolHandler,

		async register(server: McpServer): Promise<void> {
			const configWithGraph = {
				...toolConfig,
				_meta: { _flowGraph: flowGraph },
			};
			server.registerTool(
				config.id,
				configWithGraph as typeof toolConfig,
				toolHandler,
			);
		},
		graph: input.graph,
		flowGraph,
	};
}
