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
	FlowToolInput,
	McpServer,
	RegisteredFlow,
} from "./@types";
import { START } from "./@types";
import { executeFrom, resolveNextNode, type ValidateFn } from "./execute";
import { type FlowStore, WaniwaniFlowStore } from "./flow-store";
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
	const protocol = buildFlowProtocol(config);
	const fullDescription = `${config.description}\n${protocol}`;

	// Server-side state store — keyed by sessionId, backed by WaniWani API.
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
			const startEdge = edges.get(START);
			if (!startEdge) {
				return {
					content: { status: "error" as const, error: "No start edge" },
				};
			}

			const startState = { ...(args.stateUpdates ?? {}) } as TState;
			const firstNode = await resolveNextNode(startEdge, startState);
			return executeFrom(
				firstNode,
				startState,
				nodes,
				edges,
				validators,
				meta,
				waniwani,
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

			const flowState = await store.get(sessionId);

			if (!flowState) {
				return {
					content: {
						status: "error" as const,
						error: "Flow state not found. The flow may have expired.",
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
							"Flow state is missing the current step. The flow may have expired.",
					},
				};
			}

			const updatedState = {
				...state,
				...(args.stateUpdates ?? {}),
			} as TState;

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
			);
		}

		return {
			content: {
				status: "error" as const,
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
				},
				(async (args: FlowToolInput, extra: unknown) => {
					const requestExtra = extra as RequestHandlerExtra<
						ServerRequest,
						ServerNotification
					>;
					const _meta: Record<string, unknown> = requestExtra._meta ?? {};
					const sessionId = extractSessionId(_meta);
					const waniwani = extractScopedClient(requestExtra);

					const result = await handleToolCall(args, sessionId, _meta, waniwani);

					// Persist flow state under session ID
					if (result.flowTokenContent && sessionId) {
						await store.set(sessionId, result.flowTokenContent);
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
				}) satisfies ToolCallback<typeof inputSchema>,
			);
		},
	};
}
