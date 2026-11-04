import { describe, expect, test } from "bun:test";
import type { UIMessage } from "ai";
import { formatTranscript } from "./conversation-transcript";

const LABELS = {
	header:
		"Conversation with the assistant · 30 October 2026 · shop.example.com",
	you: "You:",
	assistant: "Assistant:",
};

describe("formatTranscript", () => {
	test("formats user and assistant text parts with labels", () => {
		const messages: UIMessage[] = [
			{
				id: "u1",
				role: "user",
				parts: [{ type: "text", text: "What is the excess?" }],
			},
			{
				id: "a1",
				role: "assistant",
				parts: [
					{ type: "text", text: "It is 500 euros." },
					{ type: "text", text: "Anything else?" },
				],
			},
		];

		expect(formatTranscript(messages, LABELS)).toBe(
			[
				LABELS.header,
				"You:\nWhat is the excess?",
				"Assistant:\nIt is 500 euros.",
				"Assistant:\nAnything else?",
			].join("\n\n"),
		);
	});

	test("skips non-text parts", () => {
		const messages = [
			{
				id: "a1",
				role: "assistant",
				parts: [
					{ type: "reasoning", text: "Let me think" },
					{
						type: "tool-lookup",
						toolCallId: "call-1",
						state: "output-available",
						input: {},
						output: { ok: true },
					},
					{ type: "file", mediaType: "image/png", url: "https://x.test/a.png" },
					{ type: "text", text: "Here you go." },
				],
			},
		] as UIMessage[];

		expect(formatTranscript(messages, LABELS)).toBe(
			`${LABELS.header}\n\nAssistant:\nHere you go.`,
		);
	});
});
