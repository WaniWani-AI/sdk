import { readUIMessageStream, type UIMessage } from "ai";
import { type EveEvent, uiMessageChunks } from "./ui-stream";

function visitorText(data: unknown): string | undefined {
	if (typeof data !== "object" || data === null || "kind" in data) {
		return undefined;
	}
	return "message" in data && typeof data.message === "string"
		? data.message
		: undefined;
}

async function reply(
	events: readonly EveEvent[],
): Promise<UIMessage | undefined> {
	const stream = new ReadableStream<EveEvent>({
		start(controller) {
			for (const event of events) {
				controller.enqueue(event);
			}
			controller.close();
		},
	}).pipeThrough(uiMessageChunks());
	let message: UIMessage | undefined;
	for await (const snapshot of readUIMessageStream({ stream })) {
		message = snapshot;
	}
	return message?.parts.length ? message : undefined;
}

/** A resumed session's events as the messages the chat shows. */
export async function historyMessages(
	events: readonly EveEvent[],
): Promise<UIMessage[]> {
	const turns: { visitor: UIMessage; events: EveEvent[] }[] = [];
	for (const event of events) {
		const text =
			event.type === "message.received" ? visitorText(event.data) : undefined;
		if (text !== undefined) {
			turns.push({
				visitor: {
					id: event.meta?.id ?? crypto.randomUUID(),
					role: "user",
					parts: [{ type: "text", text }],
				},
				events: [],
			});
		} else {
			turns.at(-1)?.events.push(event);
		}
	}
	const messages: UIMessage[] = [];
	for (const turn of turns) {
		messages.push(turn.visitor);
		const answer = await reply(turn.events);
		if (answer) {
			messages.push(answer);
		}
	}
	return messages;
}
