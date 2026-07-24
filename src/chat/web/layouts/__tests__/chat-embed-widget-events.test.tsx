import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { Window } from "happy-dom";

// biome-ignore lint/suspicious/noExplicitAny: test setup
(globalThis as any).indexedDB = new IDBFactory();
// biome-ignore lint/suspicious/noExplicitAny: test setup
(globalThis as any).IDBKeyRange = IDBKeyRange;

// ---------------------------------------------------------------------------
// Set up DOM globals before importing React
// ---------------------------------------------------------------------------

const win = new Window({ url: "https://localhost" });
for (const key of [
	"document",
	"navigator",
	"HTMLElement",
	"HTMLDivElement",
	"HTMLAnchorElement",
	"HTMLButtonElement",
	"HTMLTextAreaElement",
	"MutationObserver",
	"IntersectionObserver",
	"customElements",
	"Element",
	"Node",
	"Text",
	"Comment",
	"DocumentFragment",
	"Event",
	"CustomEvent",
	"MouseEvent",
	"KeyboardEvent",
	"requestAnimationFrame",
	"cancelAnimationFrame",
	"getComputedStyle",
] as const) {
	// biome-ignore lint/suspicious/noExplicitAny: test setup
	(globalThis as any)[key] = (win as any)[key];
}
// React checks for `window` specifically
// biome-ignore lint/suspicious/noExplicitAny: test setup
(globalThis as any).window = win;
// happy-dom's selector parser instantiates `window.SyntaxError`, which is
// uninitialized when running under Bun — wire it to the global constructor.
// biome-ignore lint/suspicious/noExplicitAny: test setup
(win as any).SyntaxError = SyntaxError;
// Tell React this is a test environment so act() works without warnings
// biome-ignore lint/suspicious/noExplicitAny: test setup
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// Now safe to import React
const { act, createElement } = await import("react");
const { createRoot } = await import("react-dom/client");
type Root = ReturnType<typeof createRoot>;

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockSendMessage = mock(() => {});

// @ts-expect-error -- bun:test `mock.module` exists at runtime but has no TS type
mock.module("@ai-sdk/react", () => ({
	useChat() {
		return {
			messages: [],
			sendMessage: mockSendMessage,
			setMessages: mock(() => {}),
			status: "ready",
		};
	},
}));

// @ts-expect-error -- bun:test `mock.module` exists at runtime but has no TS type
mock.module("../../lib/lenient-chat-transport", () => ({
	LenientChatTransport: class {},
}));

const originalFetch = globalThis.fetch;
beforeEach(() => {
	globalThis.fetch = mock(async () =>
		Response.json({ tools: [] }),
	) as unknown as typeof fetch;
});
afterEach(() => {
	globalThis.fetch = originalFetch;
});

// Now import the components under test (after mocks are registered)
const { ChatEmbed } = await import("../chat-embed");
const { WidgetEventsProvider } = await import(
	"../../embed/widget-events-context"
);
const { createWidgetEventEmitter } = await import("../../embed/widget-events");
type WidgetEventType = import("../../embed/widget-events").WidgetEvent;

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

let root: Root | null = null;
let container: HTMLElement | null = null;

afterEach(() => {
	if (root) {
		act(() => {
			root?.unmount();
		});
		root = null;
	}
	container?.remove();
	container = null;
});

async function renderEmbed() {
	const emitter = createWidgetEventEmitter({ mode: "inline" });
	const events: WidgetEventType[] = [];
	emitter.subscribe((event) => events.push(event));

	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);

	await act(async () => {
		root?.render(
			createElement(
				WidgetEventsProvider,
				{ value: emitter },
				createElement(ChatEmbed, {
					api: "https://example.com/api/chat",
					suggestions: { initial: ["First suggestion", "Second suggestion"] },
				}),
			),
		);
	});

	return { events };
}

function clickElement(el: Element) {
	el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ChatEmbed widget events", () => {
	test("clicking a suggestion pill emits suggestion.clicked with its index", async () => {
		const { events } = await renderEmbed();

		const pill = [...document.querySelectorAll("button")].find(
			(button) => button.textContent === "Second suggestion",
		);
		expect(pill).toBeDefined();

		await act(async () => {
			if (pill) {
				clickElement(pill);
			}
		});

		const clicks = events.filter((e) => e.name === "suggestion.clicked");
		expect(clicks).toHaveLength(1);
		expect(clicks[0]).toMatchObject({
			name: "suggestion.clicked",
			mode: "inline",
			properties: { text: "Second suggestion", index: 1 },
		});
	});

	test("clicking an anchor inside the messages scroller emits link.clicked", async () => {
		const { events } = await renderEmbed();

		const scroller = document.querySelector('div[class*="ww:overflow-y-auto"]');
		expect(scroller).not.toBeNull();

		const anchor = document.createElement("a");
		anchor.setAttribute("href", "https://example.com/docs");
		anchor.textContent = "docs";
		anchor.addEventListener("click", (e) => e.preventDefault());
		scroller?.appendChild(anchor);

		await act(async () => {
			clickElement(anchor);
		});

		const clicks = events.filter((e) => e.name === "link.clicked");
		expect(clicks).toHaveLength(1);
		expect(clicks[0]).toMatchObject({
			name: "link.clicked",
			mode: "inline",
			properties: { url: "https://example.com/docs" },
		});
	});
});
