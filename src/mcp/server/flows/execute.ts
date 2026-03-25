import type { ScopedWaniWaniClient } from "../scoped-client";
import type {
	Edge,
	ExecutionResult,
	InterruptQuestionData,
	MaybePromise,
	NodeHandler,
} from "./@types";
import { END, interrupt, isInterrupt, isWidget, showWidget } from "./@types";
import { deepMerge, deleteNestedValue, getNestedValue } from "./nested";

// ============================================================================
// Helpers
// ============================================================================

/** Check whether a state value counts as "filled" (not empty/missing). */
export function isFilled(v: unknown): boolean {
	return v !== undefined && v !== null && v !== "";
}

export type ValidateFn = (
	value: unknown,
	// biome-ignore lint/suspicious/noConfusingVoidType: void needed for async () => {} validators
) => MaybePromise<Record<string, unknown> | void>;

// ============================================================================
// Edge resolution
// ============================================================================

export async function resolveNextNode<TState extends Record<string, unknown>>(
	edge: Edge<TState>,
	state: Partial<TState>,
): Promise<string> {
	if (edge.type === "direct") {
		return edge.to;
	}
	return edge.condition(state);
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
export function buildInterruptResult<TState extends Record<string, unknown>>(
	questions: InterruptQuestionData[],
	context: string | undefined,
	currentNode: string,
	state: TState,
): ExecutionResult | null {
	// All filled — caller should advance to the next node
	if (
		questions.every((q) =>
			isFilled(getNestedValue(state as Record<string, unknown>, q.field)),
		)
	) {
		return null;
	}

	// Filter out questions whose fields are already answered
	const unanswered = questions.filter(
		(q) => !isFilled(getNestedValue(state as Record<string, unknown>, q.field)),
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
// Execution engine
// ============================================================================

export async function executeFrom<TState extends Record<string, unknown>>(
	startNodeName: string,
	startState: TState,
	nodes: Map<string, NodeHandler<TState>>,
	edges: Map<string, Edge<TState>>,
	validators: Map<string, ValidateFn>,
	meta?: Record<string, unknown>,
	waniwani?: ScopedWaniWaniClient,
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
				waniwani,
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
							const value = getNestedValue(
								state as Record<string, unknown>,
								q.field,
							);
							const vResult = await fn(value);
							if (vResult && typeof vResult === "object") {
								state = deepMerge(
									state as Record<string, unknown>,
									vResult as Record<string, unknown>,
								) as TState;
							}
						} catch (err) {
							const msg = err instanceof Error ? err.message : String(err);
							deleteNestedValue(state as Record<string, unknown>, q.field);
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
							if (errResult) {
								return errResult;
							}
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
					if (
						isFilled(
							getNestedValue(state as Record<string, unknown>, widgetField),
						)
					) {
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
						interactive: result.interactive !== false,
					},
					flowTokenContent: {
						step: currentNode,
						state,
						field: widgetField,
						widgetId: result.tool.id,
					},
				};
			}

			// Action node — deep-merge state (preserves nested object siblings)
			state = deepMerge(
				state as Record<string, unknown>,
				result as Record<string, unknown>,
			) as TState;

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
