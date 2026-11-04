import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { UIMessage } from "ai";
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
