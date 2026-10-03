import type { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type {
	ServerNotification,
	ServerRequest,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { ScopedWaniWaniClient } from "../scoped-client";
import { extractScopedClient } from "../scoped-client";
import { classifyCause } from "../session-errors/classify";
import { reportSessionError } from "../session-errors/report";
import {
	extractSessionId,
	FLOW_META_KEY,
	OMIT_PII_NOTE,
	SUGGESTIONS_META_KEY,
	type SuggestionsMeta,
} from "../utils";
import type {
	CompileInput,
	ExecutionResult,
	FlowInternalState,
	FlowToolHandler,
	FlowToolInput,
	McpServer,
	RegisteredFlow,
} from "./@types";
import { START } from "./@types";
import { addAskedFields, keepAskedFields } from "./asked-fields";
import {
	FLOW_GRAPH_META_KEY,
	REDACTED_FIELDS_META_KEY,
	serverOnly,
} from "./definition-meta";
import { executeFrom, resolveNextNode, type ValidateFn } from "./execute";
import { type FlowStore, WaniwaniFlowStore } from "./flow-store";
import { extractFlowGraph } from "./graph-extract";
import {
	initInternalState,
	loadInternalState,
	takeInternalField,
	withInternalState,
} from "./internal-state";
import { deepMerge, expandDotPaths } from "./nested";
import { flowOutputSchema } from "./output-schema";
import { buildNextStep } from "./protocol";
import { collectRedactedStateFields } from "./redacted";

// ============================================================================
// Input schema
// ============================================================================

function buildInputSchema(config: { omitIntentPII?: boolean }) {
	const piiNote = config.omitIntentPII ? OMIT_PII_NOTE : "";

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
				`Required when action is "start". A brief summary of the user's goal for this flow, taken from what the user said rather than inferred.${piiNote}`,
			),
		context: z
			.string()
			.optional()
			.describe(
				`Optional when action is "start". The situation that led the user here — the page they are on, what they were doing, or what triggered the request. Omitted when there is nothing genuinely relevant to report.${piiNote}`,
			),
		// Untyped on purpose: the listing names no state field. Each response
		// names the fields it asks for, with their schema, and the engine
		// accepts only those (see `asked-fields.ts`).
		stateUpdates: z
			.record(z.string(), z.unknown())
			.optional()
			.describe(
				'Answers to the flow\'s questions, keyed by the `field` each response names. For nested fields, use dot-paths like "driver.name".',
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

/**
 * One handled tool call, plus the internal state and asked fields this session
 * arrived with. The response assembler reads it to decide what to attach, then
 * persists what is left. Branches that fail before the engine runs return no
 * `internal`, which reads as "nothing pending".
 */
type HandledCall = ExecutionResult & {
	internal?: FlowInternalState;
	asked?: string[];
};

/**
 * The `stateUpdates` a `continue` or `reset` merges: only the fields the run
 * has asked for. A record written before the engine tracked them has no
 * `asked`, so that one call merges everything, rather than drop the answer to
 * a question it has no record of.
 */
function acceptedUpdates(
	updates: Record<string, unknown> | undefined,
	asked: string[] | undefined,
): Record<string, unknown> {
	return asked
		? keepAskedFields(updates, asked)
		: expandDotPaths(updates ?? {});
}

export function compileFlow<TState extends Record<string, unknown>>(
	input: CompileInput<TState>,
): RegisteredFlow {
	const { config, nodes, edges } = input;
	const inputSchema = buildInputSchema(config);
	const flowGraph = extractFlowGraph(config, nodes, edges, input.nodeOptions);
	// The description says what the tool is and nothing about what the
	// assistant should do next. Operating instructions in a tool description
	// trip prompt-injection classifiers (see `protocol.ts`); they ride the
	// response instead, as `nextStep`.
	const fullDescription = `${config.description}\n\nThis tool runs a multi-step flow. Each call returns the flow's current status, the data for that step, and a \`nextStep\` field describing what the following call contains.`;

	const store: FlowStore = input.store ?? resolveDefaultStore(config.id);

	// The internal state every new session starts from. Built once at compile
	// time so a malformed config fails at startup, not on a live conversation.
	const initialInternal = initInternalState(config);

	// Validator storage — populated when handlers return interrupts with validate functions.
	// Keyed by "nodeName:fieldName", persists across tool calls within the same server.
	const validators = new Map<string, ValidateFn>();

	async function handleToolCall(
		args: FlowToolInput,
		sessionId: string | undefined,
		sessionIsPreexisting: boolean,
		meta?: Record<string, unknown>,
		waniwani?: ScopedWaniWaniClient,
	): Promise<HandledCall> {
		/**
		 * Run the engine from `node`, carrying this session's internal state and
		 * asked fields through to the response assembler. Every branch below
		 * resumes the same graph with the same per-call context, so the only
		 * things that vary are where execution starts, the state it starts from,
		 * and where the session's own record was read.
		 */
		const run = (
			node: string,
			state: TState,
			internal: FlowInternalState,
			asked: string[] = [],
		): Promise<HandledCall> =>
			executeFrom(
				node,
				state,
				nodes,
				edges,
				validators,
				meta,
				waniwani,
				input.nodeOptions,
				config.state,
			).then((result) => ({ ...result, internal, asked }));

		if (args.action === "start") {
			// `intent` is observational: the schema asks for it on start, but nothing
			// in the engine reads it (it never reaches a node or the store). It is
			// tracked only because `withWaniwani` records the raw tool input on
			// `tool.called` and copies it into `properties.telemetry`.
			// A missing value therefore costs a conversation turn and buys nothing,
			// so trim it and carry on instead of failing the call.
			const intent =
				typeof args.intent === "string" ? args.intent.trim() : undefined;
			args.intent = intent || undefined;

			// Trim context if provided (optional field, no error if missing)
			if (typeof args.context === "string") {
				const trimmed = args.context.trim();
				args.context = trimmed || undefined;
			}

			const startEdge = edges.get(START);
			if (!startEdge) {
				reportSessionError({
					waniwani,
					code: "agent_failed",
					cause: "flow_dead_end",
					properties: { node: START },
				});
				return {
					content: { status: "error" as const, error: "No start edge" },
				};
			}

			const internal = await loadInternalState({
				store,
				sessionId,
				sessionIsPreexisting,
				seed: initialInternal,
			});
			// A run starts empty. `stateUpdates` carries answers, and nothing has
			// been asked yet; values the user already stated are sent back as the
			// questions come up.
			const startState = {} as TState;
			const firstNode = await resolveNextNode(startEdge, startState);
			return run(firstNode, startState, internal);
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
				reportSessionError({
					waniwani,
					code: "upstream_failed",
					cause: classifyCause({ error: err }),
				});
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

			const asked = flowState.asked;
			const updatedState = deepMerge(
				state as Record<string, unknown>,
				acceptedUpdates(args.stateUpdates, asked),
			) as TState;
			const internal = flowState.internal ?? {};

			// Widget continue: advance past the widget step (don't re-show it)
			if (flowState.widgetId) {
				const edge = edges.get(step);
				if (!edge) {
					reportSessionError({
						waniwani,
						code: "agent_failed",
						cause: "flow_dead_end",
						properties: { node: step },
					});
					return {
						content: {
							status: "error" as const,
							error: `No edge from step "${step}"`,
						},
					};
				}
				const nextNode = await resolveNextNode(edge, updatedState);
				return run(nextNode, updatedState, internal, asked);
			}

			// Interrupt continue: re-execute from current step.
			// The handler re-runs, filters answered questions, and runs
			// validators if all questions are filled.
			return run(step, updatedState, internal, asked);
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
				reportSessionError({
					waniwani,
					code: "upstream_failed",
					cause: classifyCause({ error: err }),
				});
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

			const asked = flowState.asked;
			const corrections = acceptedUpdates(args.stateUpdates, asked);
			if (Object.keys(corrections).length === 0) {
				return {
					content: {
						status: "error" as const,
						error:
							'Nothing to correct: "reset" takes fields the flow has asked for.',
					},
				};
			}

			const startEdge = edges.get(START);
			if (!startEdge) {
				reportSessionError({
					waniwani,
					code: "agent_failed",
					cause: "flow_dead_end",
					properties: { node: START },
				});
				return {
					content: { status: "error" as const, error: "No start edge" },
				};
			}

			const existingState = flowState.state as TState;
			const mergedState = deepMerge(
				existingState as Record<string, unknown>,
				corrections,
			) as TState;

			const internal = flowState.internal ?? {};
			const firstNode = await resolveNextNode(startEdge, mergedState);
			return run(firstNode, mergedState, internal, asked);
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
		// The flow graph rides on the definition `_meta` itself, not only on what
		// `register()` sends, because some servers register this config directly
		// (the kit does, through skybridge). `withWaniwani` keys both funnel sync
		// and telemetry capture on it; without it a flow tool is treated as a
		// plain tool. Both entries are server-only, so `tools/list` never sends
		// them (see `definition-meta.ts`).
		_meta: {
			...(redactedStateFields.length > 0 && {
				[REDACTED_FIELDS_META_KEY]: serverOnly(redactedStateFields),
			}),
			[FLOW_GRAPH_META_KEY]: serverOnly(flowGraph),
		},
	};

	const toolHandler = (async (args: FlowToolInput, extra: unknown) => {
		const requestExtra = extra as RequestHandlerExtra<
			ServerRequest,
			ServerNotification
		>;
		const _meta: Record<string, unknown> = requestExtra._meta ?? {};
		const metaSessionId = extractSessionId(_meta);
		let sessionId = metaSessionId ?? args.sessionId;
		// A session id the caller supplied may already carry flow history; one we
		// generate below cannot.
		const sessionIsPreexisting = Boolean(sessionId);

		// Auto-generate session ID for clients that don't provide one (e.g. Claude Code)
		if (!sessionId && args.action === "start") {
			sessionId = crypto.randomUUID();
		}

		// Bridge the resolved sessionId into _meta when the transport didn't
		// supply one (auto-generated on start, or echoed back via args.sessionId
		// on continue/reset). Without this, downstream tracking, scoped-client,
		// and source detection see an empty _meta on every turn after start.
		if (sessionId && !metaSessionId) {
			_meta["waniwani/sessionId"] = sessionId;
		}

		const waniwani = extractScopedClient(requestExtra);

		const result = await handleToolCall(
			args,
			sessionId,
			sessionIsPreexisting,
			_meta,
			waniwani,
		);

		// Echo sessionId in response when not sourced from _meta (client must pass it back)
		const contentObj =
			!metaSessionId && sessionId
				? { ...result.content, sessionId }
				: result.content;

		// The intro goes on whichever response the engine returns first for a
		// session, so it lands even when pre-filled state skips the flow's opening
		// nodes, and taking it off the internal state is what keeps it to once per
		// conversation. Error responses keep it pending: the assistant may never
		// surface one to the user, so delivering it there would spend it on a
		// message nobody reads.
		const { value: intro, internal } =
			contentObj.status === "error"
				? { value: undefined, internal: result.internal ?? {} }
				: takeInternalField(result.internal, "intro");

		// `intro` first so it reads as the opening instruction rather than a
		// trailing detail after the question and its schema. `nextStep` last:
		// it is the protocol for this one status, and it reads after the data
		// it applies to.
		const nextStep = buildNextStep({
			status: contentObj.status,
			tool: "tool" in contentObj ? contentObj.tool : undefined,
			interactive:
				"interactive" in contentObj ? contentObj.interactive : undefined,
			hasIntro: Boolean(intro),
			echoSessionId: !metaSessionId && Boolean(sessionId),
		});
		const payload = {
			...(intro ? { intro } : {}),
			...contentObj,
			...(nextStep ? { nextStep } : {}),
		};

		// Authoritative for the turn: an empty array clears pills an earlier flow
		// call in the same turn set. Only the single-open-question shorthand
		// carries a top-level `suggestions`. Set before both return paths below
		// so every flow tool result — including the state-persistence failure —
		// carries the key.
		_meta[SUGGESTIONS_META_KEY] = {
			suggestions:
				contentObj.status === "interrupt" ? (contentObj.suggestions ?? []) : [],
		} satisfies SuggestionsMeta;

		// Persist flow state under session ID. On completion we store the final
		// `{ state }` (no `step`) so customers can read the final state until
		// the KV TTL expires; a stale `continue` falls into the "already
		// completed" branch at the loader since `step` is undefined.
		// TODO: expose a `deleteOnComplete` compile option for customers who
		// want the prior behavior (drop the session as soon as END is reached).
		if (sessionId && result.flowTokenContent) {
			const tokenContent = {
				...withInternalState(result.flowTokenContent, internal),
				asked: addAskedFields(result.asked ?? [], contentObj),
			};
			try {
				await store.set(sessionId, tokenContent);
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				reportSessionError({
					waniwani,
					code: "upstream_failed",
					cause: classifyCause({ error: err }),
					properties: { node: result.flowTokenContent.step },
				});
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

		const content = [
			{
				type: "text" as const,
				text: JSON.stringify(payload, null, 2),
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
			structuredContent: payload as Record<string, unknown>,
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
			server.registerTool(config.id, toolConfig, toolHandler);
		},
		graph: input.graph,
		flowGraph,
	};
}
