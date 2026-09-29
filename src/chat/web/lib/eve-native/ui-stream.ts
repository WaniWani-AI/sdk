/**
 * An eve session's events as the AI SDK UI message stream the chat renders.
 * Mirrors `@waniwani/agent-adapter`'s translation, which the app's forwarding
 * path runs server-side.
 */
import type { UIMessageChunk } from "ai";

/** One NDJSON line off an eve session stream. */
export type EveEvent = {
	readonly type: string;
	readonly data?: unknown;
	readonly meta?: {
		readonly deliveryIds?: readonly string[];
		readonly id?: string;
	};
};

type Controller = TransformStreamDefaultController<UIMessageChunk>;

type ToolAction = {
	kind?: string;
	callId?: string;
	toolName?: string;
	input?: unknown;
	output?: unknown;
	isError?: boolean;
};

export function uiMessageChunks(): TransformStream<EveEvent, UIMessageChunk> {
	const announced = new Set<string>();
	const models = new Map<number, string>();
	let textId: string | undefined;
	let textCount = 0;
	let stepOpen = false;
	let failed = false;

	const startText = (controller: Controller): string => {
		if (!textId) {
			textId = `text-${++textCount}`;
			controller.enqueue({ type: "text-start", id: textId });
		}
		return textId;
	};
	const endText = (controller: Controller): void => {
		if (textId) {
			controller.enqueue({ type: "text-end", id: textId });
			textId = undefined;
		}
	};
	const write = (controller: Controller, delta: string): void => {
		controller.enqueue({
			type: "text-delta",
			id: startText(controller),
			delta,
		});
	};
	const announce = (
		controller: Controller,
		call: ToolAction,
		input: unknown,
	): void => {
		if (!call.callId || announced.has(call.callId)) {
			return;
		}
		announced.add(call.callId);
		controller.enqueue({
			type: "tool-input-available",
			toolCallId: call.callId,
			toolName: call.toolName ?? call.kind ?? "tool",
			input,
			dynamic: true,
		});
	};

	return new TransformStream<EveEvent, UIMessageChunk>({
		start(controller) {
			controller.enqueue({ type: "start", messageId: crypto.randomUUID() });
		},

		transform(event, controller) {
			switch (event.type) {
				case "step.started": {
					const { modelId, stepIndex } = event.data as {
						modelId?: string;
						stepIndex?: number;
					};
					if (typeof stepIndex === "number" && modelId) {
						models.set(stepIndex, modelId);
					}
					controller.enqueue({ type: "start-step" });
					stepOpen = true;
					break;
				}

				case "message.appended": {
					const { messageDelta } = event.data as { messageDelta?: string };
					if (messageDelta) {
						write(controller, messageDelta);
					}
					break;
				}

				case "message.completed": {
					const { message } = event.data as { message?: string };
					if (!textId && message) {
						write(controller, message);
					}
					endText(controller);
					break;
				}

				case "actions.requested": {
					endText(controller);
					const { actions } = event.data as { actions?: ToolAction[] };
					for (const action of actions ?? []) {
						announce(controller, action, action.input);
					}
					break;
				}

				case "action.result": {
					const { result, status, error } = event.data as {
						result?: ToolAction;
						status?: string;
						error?: { message?: string };
					};
					if (result?.kind !== "tool-result" || !result.callId) {
						break;
					}
					announce(controller, result, {});

					// A rejected or erroring call must never reach the embed as a success
					// chunk: the widget would render an error body as its output.
					if (result.isError === true || (status && status !== "completed")) {
						controller.enqueue({
							type: "tool-output-error",
							toolCallId: result.callId,
							errorText: error?.message ?? "The tool call failed.",
							dynamic: true,
						});
						break;
					}
					controller.enqueue({
						type: "tool-output-available",
						toolCallId: result.callId,
						output: result.output,
						dynamic: true,
					});
					break;
				}

				case "step.completed": {
					const { stepIndex, usage } = event.data as {
						stepIndex?: number;
						usage?: unknown;
					};
					endText(controller);
					if (stepOpen) {
						controller.enqueue({ type: "finish-step" });
						stepOpen = false;
					}
					const modelId =
						typeof stepIndex === "number" ? models.get(stepIndex) : undefined;
					controller.enqueue({
						type: "message-metadata",
						messageMetadata: { "waniwani/step": { stepIndex, modelId, usage } },
					});
					break;
				}

				case "turn.failed":
				case "session.failed": {
					const { message } = event.data as { message?: string };
					failed = true;
					controller.enqueue({
						type: "error",
						errorText: message ?? "The agent could not answer.",
					});
					break;
				}
			}
		},

		flush(controller) {
			endText(controller);
			if (stepOpen) {
				controller.enqueue({ type: "finish-step" });
			}
			controller.enqueue({
				type: "finish",
				finishReason: failed ? "error" : "stop",
			});
		},
	});
}
