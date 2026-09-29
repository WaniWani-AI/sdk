import { describe, expect, test } from "bun:test";
import type { UIMessageChunk } from "ai";

// Other test files fake this module for the whole run; a query-suffixed
// import bypasses that fake.
const realTransportPath = "../lenient-chat-transport.ts?real";
const { LenientChatTransport }: typeof import("../lenient-chat-transport") =
	await import(realTransportPath);

// The page can only answer tool calls whose pieces survive the transport.
// AI SDK 7's toolMetadata strip is tracked separately in WAN-1338.

function sse(lines: string[]): Response {
	const body = `${lines.map((l) => `data: ${l}`).join("\n\n")}\n\ndata: [DONE]\n\n`;
	return new Response(body, {
		headers: {
			"content-type": "text/event-stream",
			"x-vercel-ai-ui-message-stream": "v1",
		},
	});
}

async function chunksThrough(lines: string[]): Promise<UIMessageChunk[]> {
	const transport = new LenientChatTransport({
		api: "https://acme.example/api/waniwani",
		fetch: (async () => sse(lines)) as unknown as typeof fetch,
	});
	const stream = await transport.sendMessages({
		chatId: "chat_1",
		messages: [],
		abortSignal: undefined,
		trigger: "submit-message",
		messageId: undefined,
	});
	const out: UIMessageChunk[] = [];
	const reader = stream.getReader();
	for (;;) {
		const { done, value } = await reader.read();
		if (done) {
			return out;
		}
		out.push(value);
	}
}

const AVAILABLE = {
	type: "tool-input-available",
	toolCallId: "call_1",
	toolName: "get_page_title",
	input: { selector: "h1" },
};

describe("LenientChatTransport keeps the tool-call pieces the page answers", () => {
	test("a tool-input-available piece as AI SDK 6 writes it passes through unchanged", async () => {
		const out = await chunksThrough([JSON.stringify(AVAILABLE)]);

		expect(out).toEqual([AVAILABLE]);
	});

	test("a piece of a type the browser does not know is skipped without losing the tool call", async () => {
		const out = await chunksThrough([
			JSON.stringify({ type: "tool-telemetry-from-the-future", x: 1 }),
			JSON.stringify(AVAILABLE),
		]);

		expect(out).toEqual([AVAILABLE]);
	});

	test("a malformed line is skipped without losing the tool call after it", async () => {
		const out = await chunksThrough(["{not json", JSON.stringify(AVAILABLE)]);

		expect(out).toEqual([AVAILABLE]);
	});

	test("a server-run tool's result piece passes through unchanged", async () => {
		const output = {
			type: "tool-output-available",
			toolCallId: "call_1",
			output: { title: "Pricing" },
		};

		const out = await chunksThrough([JSON.stringify(output)]);

		expect(out).toEqual([output]);
	});
});
