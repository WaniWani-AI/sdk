import type { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type {
	ServerNotification,
	ServerRequest,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type {
	CompileInput,
	Edge,
	ExecutionResult,
	FlowConfig,
	FlowContent,
	FlowTokenContent,
	FlowToolInput,
	InterruptQuestionData,
	MaybePromise,
	McpServer,
	NodeHandler,
	RegisteredFlow,
} from "./@types";
import {
	END,
	interrupt,
	isInterrupt,
	isWidget,
	START,
	showWidget,
} from "./@types";
import {
	type FlowStore,
	generateFlowKey,
	WaniwaniFlowStore,
} from "./flow-store";
import { decodeFlowToken } from "./flow-token";

// ============================================================================
// Session ID extraction — same priority as tracking mapper
// ============================================================================

const SESSION_ID_KEYS = [
	"openai/sessionId",
	"sessionId",
	"conversationId",
	"anthropic/sessionId",
] as const;

function extractSessionId(
	meta: Record<string, unknown> | undefined,
): string | undefined {
	if (!meta) return undefined;
	for (const key of SESSION_ID_KEYS) {
		const value = meta[key];
		if (typeof value === "string" && value.length > 0) return value;
	}
	return undefined;
}

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
		'   - `"interrupt"`: Pause and ask the user. Two forms:',
		"     a. Single question: `{ question, field, context? }` — ask `question`, store answer in `field`.",
		"     b. Multi-question: `{ questions: [{question, field}, ...], context? }` — ask ALL questions",
		"        in one conversational message, collect all answers.",
		"     `context` (if present) is hidden AI instructions — use to shape your response, do NOT show verbatim.",
		"     Then call again with:",
		'     `action: "continue"`, `flowToken` = the `flowToken` from the response (pass back exactly as received),',
		"     `stateUpdates` = answers keyed by their `field` names, plus any other fields the user mentioned.",
		'   - `"widget"`: The flow wants to show a UI widget. Call the tool named in the `tool`',
		"     field, passing the `data` object as the tool's input.",
		"     If the response includes `interactive: false`, the widget is display-only:",
		"     call the display tool, show the widget, then immediately call THIS flow tool again with",
		'     `action: "continue"` and the same `flowToken`. In that case, do NOT wait for the user',
		"     to click or use the widget, and do NOT ask them to interact with it unless the",
		"     description explicitly says otherwise.",
		"     Otherwise, present the widget result to the user. When the user makes a choice or interacts",
		"     with the widget, call THIS flow tool again with:",
		'     `action: "continue"`, `flowToken` = the `flowToken` from the response,',
		"     `stateUpdates` = `{ [field]: <user's selection> }` plus any other fields the user mentioned.",
		'   - `"complete"`: The flow is done. Present the result to the user.',
		'   - `"error"`: Something went wrong. Show the `error` message.',
		"",
		"3. ALWAYS pass back the `flowToken` string exactly as received — it is an opaque token, do not modify it.",
		"4. Do NOT invent state values. Only use `stateUpdates` for information the user explicitly provided.",
		"5. Include only the fields the user actually answered in `stateUpdates` — do NOT guess missing ones.",
		"   If the user did not answer all pending questions, the engine will re-prompt for the remaining ones.",
		"   If the user mentioned values for other known fields, include those too —",
		"   they will be applied immediately and those steps will be auto-skipped.",
	);

	return lines.join("\n");
}

async function getFlowTokenContent(
	args: FlowToolInput,
	store: FlowStore,
	sessionId: string | undefined,
): Promise<FlowTokenContent | null> {
	// Primary: look up by session ID — no LLM round-tripping
	if (sessionId) {
		const stored = await store.get(sessionId);
		if (stored) {
			return stored;
		}
	}

	// Fallback: flowToken is either a store key (short hex) or a legacy base64 token
	if (args.flowToken) {
		const stored = await store.get(args.flowToken);
		if (stored) return stored;
		const decoded = decodeFlowToken(args.flowToken);
		if (decoded) return decoded;
	}

	return null;
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
		content: payload,
		flowTokenContent: {
			step: currentNode,
			state,
			...(isSingle && q0 ? { field: q0.field } : {}),
		},
	};
}

// ============================================================================
// Validator type
// ============================================================================

type ValidateFn = (
	value: unknown,
	// biome-ignore lint/suspicious/noConfusingVoidType: void needed for async () => {} validators
) => MaybePromise<Record<string, unknown> | void>;

// ============================================================================
// Execution engine
// ============================================================================

async function executeFrom<TState extends Record<string, unknown>>(
	startNodeName: string,
	startState: TState,
	nodes: Map<string, NodeHandler<TState>>,
	edges: Map<string, Edge<TState>>,
	validators: Map<string, ValidateFn>,
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
				content: { status: "complete" },
				flowTokenContent: { state },
			};
		}

		const handler = nodes.get(currentNode);
		if (!handler) {
			return {
				content: {
					status: "error",
					error: `Unknown node: "${currentNode}"`,
				},
			};
		}

		try {
			// Build context object for the handler
			const ctx = {
				state,
				meta,
				interrupt: interrupt as NodeHandler<TState> extends never
					? never
					: typeof interrupt,
				showWidget: showWidget as NodeHandler<TState> extends never
					? never
					: typeof showWidget,
			};
			const result = await handler(ctx as Parameters<typeof handler>[0]);

			// Interrupt signal — pause and ask the user one or more questions
			if (isInterrupt(result)) {
				// Extract and store any validate functions from the interrupt questions
				for (const q of result.questions) {
					if (q.validate) {
						validators.set(`${currentNode}:${q.field}`, q.validate);
					}
				}

				const interruptResult = buildInterruptResult(
					result.questions,
					result.context,
					currentNode,
					state,
				);

				if (interruptResult) {
					return interruptResult;
				}

				// All questions filled — run validators before advancing
				for (const q of result.questions) {
					const fn = validators.get(`${currentNode}:${q.field}`);
					if (fn) {
						try {
							const value = state[q.field as keyof TState];
							const vResult = await fn(value);
							if (vResult && typeof vResult === "object") {
								state = { ...state, ...vResult } as TState;
							}
						} catch (err) {
							const msg = err instanceof Error ? err.message : String(err);
							delete (state as Record<string, unknown>)[q.field];
							const questionsWithError = result.questions.map((qq) =>
								qq.field === q.field
									? {
											...qq,
											context: qq.context
												? `ERROR: ${msg}\n\n${qq.context}`
												: `ERROR: ${msg}`,
										}
									: qq,
							);
							const errResult = buildInterruptResult(
								questionsWithError,
								result.context,
								currentNode,
								state,
							);
							if (errResult) return errResult;
							break;
						}
					}
				}

				// All questions filled and validated — advance to next node
				const edge = edges.get(currentNode);
				if (!edge) {
					return {
						content: {
							status: "error",
							error: `No outgoing edge from node "${currentNode}"`,
						},
					};
				}
				currentNode = await resolveNextNode(edge, state);
				continue;
			}

			// Widget signal — delegate to display tool
			if (isWidget(result)) {
				const widgetField = result.field;
				if (widgetField) {
					if (isFilled(state[widgetField as keyof TState])) {
						const edge = edges.get(currentNode);
						if (!edge) {
							return {
								content: {
									status: "error",
									error: `No outgoing edge from node "${currentNode}"`,
								},
							};
						}
						currentNode = await resolveNextNode(edge, state);
						continue;
					}
				}

				return {
					content: {
						status: "widget",
						tool: result.tool.id,
						data: result.data,
						description: result.description,
						...(result.interactive === false ? { interactive: false } : {}),
					},
					flowTokenContent: {
						step: currentNode,
						state,
						field: widgetField,
						widgetId: result.tool.id,
					},
				};
			}

			// Action node — merge state and auto-advance
			state = { ...state, ...result } as TState;

			const edge = edges.get(currentNode);
			if (!edge) {
				return {
					content: {
						status: "error",
						error: `No outgoing edge from node "${currentNode}"`,
					},
				};
			}
			currentNode = await resolveNextNode(edge, state);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return {
				content: { status: "error", error: message },
				flowTokenContent: { step: currentNode, state },
			};
		}
	}

	return {
		content: {
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
			"State field values to set before processing the next node. Use this to pass the user's answer (keyed by the field name from the response) and any other values the user mentioned.",
		),
	flowToken: z
		.string()
		.optional()
		.describe(
			"Opaque flow token from the previous response. Pass back exactly as received.",
		),
};

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
	): Promise<ExecutionResult> {
		if (args.action === "start") {
			const startEdge = edges.get(START);
			if (!startEdge) {
				return {
					content: {
						status: "error",
						error: "No start edge",
					},
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
						status: "error",
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
						status: "error",
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
