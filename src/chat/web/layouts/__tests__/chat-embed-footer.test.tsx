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

const { ChatEmbed } = await import("../chat-embed");

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

type EmbedProps = Parameters<typeof ChatEmbed>[0];

async function renderEmbed(props: Partial<EmbedProps> = {}) {
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	await act(async () => {
		root?.render(
			createElement(ChatEmbed, {
				api: "https://example.com/api/chat",
				locale: "en",
				...props,
			}),
		);
	});
	return container;
}

const logo = (el: HTMLElement) => el.querySelector("[data-waniwani-logo]");

describe("ChatEmbed footer", () => {
	test("shows the Waniwani logo and the default disclaimer by default", async () => {
		const el = await renderEmbed();
		expect(logo(el)).not.toBeNull();
		expect(el.textContent).toBe("AI agent powered bycan make mistakes");
	});

	test("hidePoweredBy removes the logo and its link but keeps a full AI disclosure", async () => {
		const el = await renderEmbed({ hidePoweredBy: true });
		expect(logo(el)).toBeNull();
		expect(el.querySelector('a[href="https://waniwani.ai"]')).toBeNull();
		expect(el.textContent).toBe("AI agent. It can make mistakes.");
	});

	test("hidePoweredBy in French keeps the AI disclosure", async () => {
		const el = await renderEmbed({ hidePoweredBy: true, locale: "fr" });
		expect(el.textContent).toBe("Agent IA. Il peut faire des erreurs.");
	});

	test("hidePoweredBy with disclaimer=false renders no footer text", async () => {
		const el = await renderEmbed({ hidePoweredBy: true, disclaimer: false });
		expect(el.textContent).toBe("");
	});

	test("hidePoweredBy with a custom disclaimer renders only that text", async () => {
		const el = await renderEmbed({
			hidePoweredBy: true,
			disclaimer: "Asistente virtual con IA de BPI.",
		});
		expect(logo(el)).toBeNull();
		expect(el.textContent).toBe("Asistente virtual con IA de BPI.");
	});
});
