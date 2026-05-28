import type { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type {
	ServerNotification,
	ServerRequest,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { ScopedWaniWaniClient } from "../scoped-client";
import { extractScopedClient } from "../scoped-client";
import { extractSessionId, FLOW_META_KEY } from "../utils";
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
import { flowOutputSchema } from "./output-schema";
import { buildFlowProtocol } from "./protocol";
import {
	collectRedactedStateFields,
	REDACTED_STATE_UPDATE_FIELDS_META_KEY,
} from "./redacted";

// ============================================================================
// Input schema
// ============================================================================

function buildInputSchema(config: {
	omitIntentPII?: boolean;
	state?: Record<string, z.ZodType>;
}) {
	const piiNote = config.omitIntentPII
		? " Do not include PII (names, emails, phones, addresses, IDs, ages, birthdates) — summarize abstractly."
		: "";

	// When the flow declares state fields, expose them as typed (optional) keys
	// on `stateUpdates` so the LLM sees field names, types, and descriptions in
	// the tool's JSON Schema. `.passthrough()` preserves unknown keys (e.g.
	// dot-paths like "driver.name" for nested state, plus forward-compat keys).
	const hasState = config.state && Object.keys(config.state).length > 0;
	const stateUpdatesSchema = hasState
		? z
				.object(config.state as Record<string, z.ZodType>)
				.partial()
				.passthrough()
		: z.record(z.string(), z.unknown());

	return {
		action: z
			.enum(["start", "continue", "reset"])
			.describe(
				'"start" to begin the flow, "continue" to resume after a pause (interrupt or widget), "reset" to restart from the beginning with a correction to a previously-collected field',
			),
		intent: z
			.string()
			.optional()
			.describe(
				`Required when action is "start". Provide a brief summary of the user's goal for this flow. Do not invent missing intent.${piiNote}`,
			),
		context: z
			.string()
			.optional()
			.describe(
				`Optional when action is "start". Describe the situation or environment that led the user to start this flow — e.g. what page they are on, what they were doing, or what triggered the request. Do not invent missing context.${piiNote}`,
			),
		stateUpdates: stateUpdatesSchema
			.optional()
			.describe(
				'State field values to set before processing the next node. Pass the user\'s answer (keyed by the field name from the response) and any other values the user mentioned. For nested state fields, use dot-paths like "driver.name".',
			),
		sessionId: z
			.string()
			.optional()
			.describe(
				'Session identifier. If the response includes a `sessionId`, pass it back on every subsequent "continue" and "reset" call for this flow.',
			),
	};
}

// ============================================================================
// Default store resolution
// ============================================================================

function resolveDefaultStore(flowId: string): FlowStore {
	if (process.env.WANIWANI_API_KEY) {
		return new WaniwaniFlowStore();
	}
	throw new Error(
		`[waniwani] createFlow "${flowId}": no flow store configured. ` +
			`Pass { store } to .compile() — use MemoryKvStore from "@waniwani/sdk/mcp" for ` +
			`local development, or plug in a Redis/Upstash/Cloudflare KV adapter for production. ` +
			`Alternatively, set WANIWANI_API_KEY to use hosted flow state on app.waniwani.ai.`,
	);
}

// ============================================================================
// Compile
// ============================================================================

export function compileFlow<TState extends Record<string, unknown>>(
	input: CompileInput<TState>,
): RegisteredFlow {
	const { config, nodes, edges } = input;
	const inputSchema = buildInputSchema(config);
	const flowGraph = extractFlowGraph(config, nodes, edges, input.nodeOptions);
	const protocol = buildFlowProtocol(config);
	const fullDescription = `${config.description}\n${protocol}`;

	const store: FlowStore = input.store ?? resolveDefaultStore(config.id);

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

			// Trim context if provided (optional field, no error if missing)
			if (typeof args.context === "string") {
				const trimmed = args.context.trim();
				args.context = trimmed || undefined;
			}

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
				config.state,
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
					config.state,
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
				config.state,
			);
		}

		if (args.action === "reset") {
			if (!sessionId) {
				return {
					content: {
						status: "error" as const,
						error: "No session ID available for reset action.",
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
						error: `Flow state not found for session "${sessionId}". The flow may have completed or expired. Use action "start" to begin a new flow.`,
					},
				};
			}

			if (!flowState.step) {
				return {
					content: {
						status: "error" as const,
						error:
							'This flow has already completed. Use action "start" to begin a new flow.',
					},
				};
			}

			if (!args.stateUpdates || Object.keys(args.stateUpdates).length === 0) {
				return {
					content: {
						status: "error" as const,
						error:
							'Missing "stateUpdates" for action "reset". Include the corrected field(s).',
					},
				};
			}

			const startEdge = edges.get(START);
			if (!startEdge) {
				return {
					content: { status: "error" as const, error: "No start edge" },
				};
			}

			const existingState = flowState.state as TState;
			const mergedState = deepMerge(
				existingState as Record<string, unknown>,
				expandDotPaths(args.stateUpdates),
			) as TState;

			const firstNode = await resolveNextNode(startEdge, mergedState);
			return executeFrom(
				firstNode,
				mergedState,
				nodes,
				edges,
				validators,
				meta,
				waniwani,
				input.nodeOptions,
				config.state,
			);
		}

		return {
			content: {
				status: "error" as const,
				error: `Unknown action: "${args.action}"`,
			},
		};
	}

	const redactedStateFields = collectRedactedStateFields(
		config.state as Record<string, z.ZodType> | undefined,
	);
	const toolConfig = {
		title: config.title,
		description: fullDescription,
		inputSchema,
		outputSchema: flowOutputSchema,
		annotations: config.annotations,
		...(redactedStateFields.length > 0 && {
			_meta: {
				[REDACTED_STATE_UPDATE_FIELDS_META_KEY]: redactedStateFields,
			},
		}),
	};

	const toolHandler = (async (args: FlowToolInput, extra: unknown) => {
		const requestExtra = extra as RequestHandlerExtra<
			ServerRequest,
			ServerNotification
		>;
		const _meta: Record<string, unknown> = requestExtra._meta ?? {};
		const metaSessionId = extractSessionId(_meta);
		let sessionId = metaSessionId ?? args.sessionId;

		// Auto-generate session ID for clients that don't provide one (e.g. Claude Code)
		if (!sessionId && args.action === "start") {
			sessionId = crypto.randomUUID();
			// Set in _meta so tracking/scoped-client picks it up
			_meta["waniwani/sessionId"] = sessionId;
		}

		const waniwani = extractScopedClient(requestExtra);

		const result = await handleToolCall(args, sessionId, _meta, waniwani);

		// Persist flow state under session ID. On completion we store the final
		// `{ state }` (no `step`) so customers can read the final state until
		// the KV TTL expires; a stale `continue` falls into the "already
		// completed" branch at the loader since `step` is undefined.
		// TODO: expose a `deleteOnComplete` compile option for customers who
		// want the prior behavior (drop the session as soon as END is reached).
		if (sessionId && result.flowTokenContent) {
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
		}

		// Echo sessionId in response when not sourced from _meta (client must pass it back)
		const contentObj =
			!metaSessionId && sessionId
				? { ...result.content, sessionId }
				: result.content;

		const content = [
			{
				type: "text" as const,
				text: JSON.stringify(contentObj, null, 2),
			},
		];

		// Attach flow execution path to _meta so it's captured in the tool.called event
		if (result.nodesVisited?.length) {
			_meta[FLOW_META_KEY] = {
				flowId: config.id,
				nodesVisited: result.nodesVisited,
			};
		}

		return {
			content,
			structuredContent: contentObj as Record<string, unknown>,
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
				_meta: { ...toolConfig._meta, _flowGraph: flowGraph },
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
