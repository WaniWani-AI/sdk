import type { UIMessage } from "ai";

export interface TranscriptLabels {
	header: string;
	you: string;
	assistant: string;
}

export function formatTranscript(
	messages: UIMessage[],
	labels: TranscriptLabels,
): string {
	const blocks = [labels.header];
	for (const message of messages) {
		if (message.role !== "user" && message.role !== "assistant") {
			continue;
		}
		const label = message.role === "user" ? labels.you : labels.assistant;
		for (const part of message.parts) {
			if (part.type === "text" && part.text.trim()) {
				blocks.push(`${label}\n${part.text}`);
			}
		}
	}
	return blocks.join("\n\n");
}

export async function copyText(text: string): Promise<boolean> {
	const clipboard =
		typeof navigator === "undefined" ? undefined : navigator.clipboard;
	if (typeof clipboard?.writeText !== "function") {
		return false;
	}
	try {
		await clipboard.writeText(text);
		return true;
	} catch {
		return false;
	}
}
