import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { UIMessage, UIMessageChunk } from "ai";
import { readUIMessageStream } from "ai";
import { Window } from "happy-dom";

const win = new Window({ url: "https://shop.example.com" });
for (const key of [
	"document",
	"navigator",
	"HTMLElement",
	"HTMLDivElement",
	"MutationObserver",
	"customElements",
	"Element",
	"Node",
	"Text",
	"Comment",
	"DocumentFragment",
	"Event",
	"CustomEvent",
	"requestAnimationFrame",
	"cancelAnimationFrame",
	"getComputedStyle",
] as const) {
	// biome-ignore lint/suspicious/noExplicitAny: test setup
	(globalThis as any)[key] = (win as any)[key];
}
// biome-ignore lint/suspicious/noExplicitAny: test setup
(globalThis as any).window = win;
// biome-ignore lint/suspicious/noExplicitAny: test setup
(win as any).SyntaxError = SyntaxError;
// biome-ignore lint/suspicious/noExplicitAny: test setup
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const { act, createElement } = await import("react");
const { createRoot } = await import("react-dom/client");
type Root = ReturnType<typeof createRoot>;

const { MessageList } = await import("./message-list");

const PDF = {
	documentId: "doc_pdf",
	filename: "policy.pdf",
	mediaType: "application/pdf",
};

let root: Root;
let container: HTMLElement;

beforeEach(() => {
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(() => {
	act(() => {
		root.unmount();
	});
	container.remove();
});

function userTurn(metadata?: unknown): UIMessage {
	return {
		id: "m1",
		role: "user",
		parts: [{ type: "text", text: "read this and tell me the excess" }],
		metadata,
	};
}

function render(messages: UIMessage[]) {
	act(() => {
		root.render(
			createElement(MessageList, { messages, status: "ready" as const }),
		);
	});
}

function documentTiles(): Element[] {
	return Array.from(container.querySelectorAll("[aria-label]"));
}

function bubble(): Element {
	const found = container.querySelector(".ww-bubble");
	if (!found) {
		throw new Error("no message bubble rendered");
	}
	return found;
}

/** Position in document order, so "before" is a claim about the rendered DOM. */
function domIndex(element: Element): number {
	return Array.from(container.querySelectorAll("*")).indexOf(element);
}

describe("MessageList — a turn that carried documents says so", () => {
	test("metadata documents render one tile each, with the filename and kind", () => {
		render([
			userTurn({
				documents: [
					PDF,
					{
						documentId: "doc_img",
						filename: "scan.png",
						mediaType: "image/png",
					},
				],
			}),
		]);

		expect(
			documentTiles().map((tile) => tile.getAttribute("aria-label")),
		).toEqual(["policy.pdf, PDF", "scan.png, Image"]);
	});

	test("a turn with no metadata renders no tile", () => {
		render([userTurn()]);

		expect(documentTiles()).toEqual([]);
		expect(bubble().textContent).toContain("read this");
	});

	test("metadata that carries no usable documents renders no tile", () => {
		for (const metadata of [
			{},
			{ documents: [] },
			{ documents: "policy.pdf" },
			{ documents: [{ filename: "policy.pdf" }] },
			{ modelContext: { excess: 500 } },
		]) {
			render([userTurn(metadata)]);
			expect(documentTiles()).toEqual([]);
		}
	});

	test("the tile sits before the bubble and outside it", () => {
		render([userTurn({ documents: [PDF] })]);

		const tile = documentTiles()[0];
		if (!tile) {
			throw new Error("no document tile rendered");
		}

		expect(domIndex(tile)).toBeLessThan(domIndex(bubble()));
		expect(bubble().contains(tile)).toBe(false);
	});

	test("the text still lands in the bubble, not beside the tiles", () => {
		render([userTurn({ documents: [PDF] })]);

		expect(bubble().textContent).toContain("read this and tell me the excess");
		expect(bubble().textContent).not.toContain("policy.pdf");
	});

	test("the bytes never enter the transcript — the tile is the only trace", () => {
		render([userTurn({ documents: [PDF] })]);

		expect(container.innerHTML).not.toContain("base64");
		expect(container.querySelector("img")).toBeNull();
	});
});

/** The assistant message AI SDK 7 builds from `chunks`, as `useChat` holds it once the stream ends. */
async function assistantFrom(chunks: UIMessageChunk[]): Promise<UIMessage> {
	const stream = new ReadableStream<UIMessageChunk>({
		start(controller) {
			for (const chunk of chunks) {
				controller.enqueue(chunk);
			}
			controller.close();
		},
	});
	let last: UIMessage | undefined;
	for await (const message of readUIMessageStream({ stream })) {
		last = message;
	}
	if (!last) {
		throw new Error("the stream built no message");
	}
	return last;
}

const CARD_METADATA = {
	clientName: "acme-mcp",
	toolName: "show_card",
	title: "Show card",
	app: {
		resourceUri: "ui://acme/card.html",
		mimeType: "text/html;profile=mcp-app",
	},
};

describe("MessageList — parts an AI SDK 7 server adds", () => {
	test("the answer renders after a custom part, and the parts the chat does not draw stay out", async () => {
		const assistant = await assistantFrom([
			{ type: "start", messageId: "a1" },
			{ type: "start-step" },
			{ type: "custom", kind: "anthropic.message_start" },
			{ type: "text-start", id: "t1" },
			{ type: "text-delta", id: "t1", delta: "The excess is 150 EUR." },
			{ type: "text-end", id: "t1", citations: [] },
			{
				type: "reasoning-file",
				mediaType: "image/png",
				url: "data:image/png;base64,AA==",
			},
			{
				type: "steering-message",
				id: "s1",
				parts: [{ type: "text", text: "a steering note" }],
			},
			{ type: "data-future-widget", data: { note: "a part type from later" } },
			{ type: "finish-step" },
			{ type: "finish", finishReason: "interrupted" },
		]);
		expect(assistant.parts.map((p) => p.type)).toEqual([
			"step-start",
			"custom",
			"text",
			"reasoning-file",
			"steering-message",
			"data-future-widget",
		]);

		render([userTurn(), assistant]);

		const bubbles = container.querySelectorAll(
			".ww-message-assistant .ww-bubble",
		);
		expect(bubbles).toHaveLength(1);
		expect(bubbles[0].textContent).toBe("The excess is 150 EUR.");
		expect(container.querySelectorAll("img")).toHaveLength(0);
		expect(container.textContent).not.toContain("a steering note");
		expect(container.textContent).not.toContain("a part type from later");
	});

	test("a tool call that carries toolMetadata shows its title and mounts its widget", async () => {
		const assistant = await assistantFrom([
			{ type: "start", messageId: "a1" },
			{ type: "start-step" },
			{ type: "custom", kind: "anthropic.message_start" },
			{
				type: "tool-input-start",
				toolCallId: "call_1",
				toolName: "show_card",
				dynamic: true,
				inputEncoding: "json",
				title: "Show card",
				toolMetadata: CARD_METADATA,
			},
			{
				type: "tool-input-available",
				toolCallId: "call_1",
				toolName: "show_card",
				dynamic: true,
				input: { city: "Paris" },
				toolMetadata: CARD_METADATA,
			},
			{
				type: "tool-output-available",
				toolCallId: "call_1",
				dynamic: true,
				output: {
					content: [{ type: "text", text: "A card for Paris." }],
					_meta: { ui: { resourceUri: "ui://acme/card.html" } },
				},
				toolMetadata: CARD_METADATA,
			},
			{ type: "finish-step" },
			{ type: "finish", finishReason: "stop" },
		]);

		act(() => {
			root.render(
				createElement(MessageList, {
					messages: [userTurn(), assistant],
					status: "ready",
					resourceEndpoint: "https://shop.example.com/api/waniwani/resource",
				}),
			);
		});

		expect(container.textContent).toContain("Show card");
		const widgets = container.querySelectorAll(".ww-widget");
		expect(widgets).toHaveLength(1);
		expect(widgets[0].getAttribute("data-display-mode")).toBe("inline");
	});
});
