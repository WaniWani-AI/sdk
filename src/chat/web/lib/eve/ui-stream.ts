/**
 * An eve session's events as the AI SDK UI message stream the chat renders.
 * Mirrors `@waniwani/agent-adapter`'s translation, which the app's forwarding
 * path runs server-side.
 */
import type { UIMessageChunk } from "ai";
import type { MessageStreamEvent, SessionFailedStreamEvent } from "eve/client";

/** One event off an eve session stream, or a failure the transport raises itself. */
export type EveEvent = MessageStreamEvent | SessionFailedStreamEvent;

type Controller = TransformStreamDefaultController<UIMessageChunk>;

type ToolCall = {
	kind: string;
	callId: string;
	toolName?: string;
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
		call: ToolCall,
		input: unknown,
	): void => {
		if (announced.has(call.callId)) {
			return;
		}
		announced.add(call.callId);
		controller.enqueue({
			type: "tool-input-available",
			toolCallId: call.callId,
			toolName: call.toolName ?? call.kind,
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
					models.set(event.data.stepIndex, event.data.modelId);
					controller.enqueue({ type: "start-step" });
					stepOpen = true;
					break;
				}

				case "message.appended": {
					if (event.data.messageDelta) {
						write(controller, event.data.messageDelta);
					}
					break;
				}

				case "message.completed": {
					if (!textId && event.data.message) {
						write(controller, event.data.message);
					}
					endText(controller);
					break;
				}

				case "actions.requested": {
					endText(controller);
					for (const action of event.data.actions) {
						announce(controller, action, action.input);
					}
					break;
				}

				case "action.result": {
					const { result, status, error } = event.data;
					if (result.kind !== "tool-result") {
						break;
					}
					announce(controller, result, {});

					// A rejected or erroring call must never reach the embed as a success
					// chunk: the widget would render an error body as its output.
					if (result.isError === true || status !== "completed") {
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
					const { stepIndex, usage } = event.data;
					endText(controller);
					if (stepOpen) {
						controller.enqueue({ type: "finish-step" });
						stepOpen = false;
					}
					controller.enqueue({
						type: "message-metadata",
						messageMetadata: {
							"waniwani/step": {
								stepIndex,
								modelId: models.get(stepIndex),
								usage,
							},
						},
					});
					break;
				}

				case "turn.failed":
				case "session.failed": {
					failed = true;
					controller.enqueue({
						type: "error",
						errorText: event.data.message || "The agent could not answer.",
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
