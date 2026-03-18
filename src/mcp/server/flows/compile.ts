import type { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type {
	ServerNotification,
	ServerRequest,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { extractSessionId } from "../utils";
import type {
	CompileInput,
	FlowContent,
	FlowToolInput,
	McpServer,
	RegisteredFlow,
} from "./@types";
import { START } from "./@types";
import { executeFrom, resolveNextNode, type ValidateFn } from "./execute";
import {
	type FlowStore,
	generateFlowKey,
	WaniwaniFlowStore,
} from "./flow-store";
import { buildFlowProtocol } from "./protocol";
import { getFlowTokenContent } from "./session";

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
	flowToken: z
		.string()
		.optional()
		.describe(
			"Opaque flow token from the previous response. Pass back exactly as received.",
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
			return executeFrom(firstNode, startState, nodes, edges, validators, meta);
		}

		if (args.action === "continue") {
			const flowTokenContent = await getFlowTokenContent(
				args,
				store,
				sessionId,
			);

			if (!flowTokenContent) {
				return {
					content: {
						status: "error" as const,
						error:
							"Flow state not found for continue action." +
							" Pass back the flowToken from the previous response exactly as received.",
					},
				};
			}

			const state = flowTokenContent.state as TState;
			const step = flowTokenContent.step;
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
			if (flowTokenContent.widgetId) {
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
				);
			}

			// Interrupt continue: re-execute from current step.
			// The handler re-runs, filters answered questions, and runs
			// validators if all questions are filled.
			return executeFrom(step, updatedState, nodes, edges, validators, meta);
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

					const result = await handleToolCall(args, sessionId, _meta);

					let flowToken: string | undefined;
					if (result.flowTokenContent) {
						if (sessionId) {
							await store.set(sessionId, result.flowTokenContent);
							flowToken = sessionId;
						} else {
							// No session ID available — fall back to random key
							const key = generateFlowKey();
							await store.set(key, result.flowTokenContent);
							flowToken = key;
						}
					}

					// Text content includes the payload + flowToken for the model
					const contentResponse: FlowContent = {
						...result.content,
						...(flowToken ? { flowToken } : {}),
					};
					const content = [
						{
							type: "text" as const,
							text: JSON.stringify(contentResponse, null, 2),
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
