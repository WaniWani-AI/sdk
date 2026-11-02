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

type EmbedProps = Parameters<typeof ChatEmbed>[0];

async function renderEmbed(overrides: Partial<EmbedProps> = {}) {
	const emitter = createWidgetEventEmitter({ mode: "inline" });
	const events: WidgetEventType[] = [];
	emitter.subscribe((event) => events.push(event));

	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);

	const props: EmbedProps = {
		api: "https://example.com/api/chat",
		suggestions: { initial: ["First suggestion", "Second suggestion"] },
		...overrides,
	};

	const render = async (next: Partial<EmbedProps> = {}) => {
		await act(async () => {
			root?.render(
				createElement(
					WidgetEventsProvider,
					{ value: emitter },
					createElement(ChatEmbed, { ...props, ...next }),
				),
			);
		});
	};

	await render();

	return { events, render };
}

function shownSets(events: WidgetEventType[]) {
	return events.filter((e) => e.name === "suggestions.shown");
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
			properties: {
				text: "Second suggestion",
				index: 1,
				origin: "channel",
			},
		});
	});

	test("the pre-chat pill row announces one impression", async () => {
		const { events } = await renderEmbed();

		expect(shownSets(events)).toHaveLength(1);
		expect(shownSets(events)[0]).toMatchObject({
			name: "suggestions.shown",
			properties: {
				texts: ["First suggestion", "Second suggestion"],
				origin: "channel",
			},
		});
	});

	test("welcome-screen cards announce their own impression", async () => {
		const { events } = await renderEmbed({
			suggestions: false,
			welcome: { title: "Hi", suggestions: ["Over 65", "Under 65"] },
		});

		expect(shownSets(events)).toHaveLength(1);
		expect(shownSets(events)[0]).toMatchObject({
			name: "suggestions.shown",
			properties: { texts: ["Over 65", "Under 65"], origin: "channel" },
		});
	});

	test("an off-screen mount holds its impression until it is shown", async () => {
		const { events, render } = await renderEmbed({ onScreen: false });
		expect(shownSets(events)).toHaveLength(0);

		await render({ onScreen: true });
		expect(shownSets(events)).toHaveLength(1);

		// Still one set, so a hide/show cycle doesn't re-count the same pills.
		await render({ onScreen: false });
		await render({ onScreen: true });
		expect(shownSets(events)).toHaveLength(1);
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

function lifecycleTransport() {
	const calls = { reset: 0, dispose: 0 };
	const factory = () => ({
		sendMessages: async () => new ReadableStream(),
		reconnectToStream: async () => null,
		reset: () => {
			calls.reset += 1;
		},
		dispose: () => {
			calls.dispose += 1;
		},
	});
	return { calls, factory: factory as unknown as EmbedProps["transport"] };
}

describe("ChatEmbed restart", () => {
	for (const enableThreadHistory of [true, false]) {
		test(`restart ${enableThreadHistory ? "starts a new thread" : "resets the chat"} with thread history ${enableThreadHistory ? "on" : "off"}`, async () => {
			const handle: { current: import("../../@types").ChatHandle | null } = {
				current: null,
			};
			const { calls, factory } = lifecycleTransport();
			const { events } = await renderEmbed({
				ref: handle,
				transport: factory,
				enableThreadHistory,
			});
			const before = { ...calls };

			await act(async () => {
				handle.current?.restart();
			});

			expect(calls.reset - before.reset).toBe(enableThreadHistory ? 0 : 1);
			expect(calls.dispose - before.dispose).toBe(enableThreadHistory ? 1 : 0);
			expect(events.map((e) => e.name)).toContain("conversation.restarted");
		});
	}
});

describe("ChatEmbed header menu", () => {
	test("without menu the header keeps its own controls", async () => {
		await renderEmbed({ title: "Assistant" });

		expect(document.querySelector(".ww-header")).not.toBeNull();
		expect(document.querySelector(".ww-menu-button")).toBeNull();
		expect(document.querySelector(".ww-dialog")).toBeNull();
	});

	test("menu replaces the header controls with one menu", async () => {
		await renderEmbed({ menu: ["new-chat", "restart"] });

		expect(document.querySelector(".ww-header .ww-menu-button")).not.toBeNull();
		expect(document.querySelector(".ww-new-chat")).toBeNull();
	});

	test("restart and copyConversation on the handle emit their events", async () => {
		const handle: { current: import("../../@types").ChatHandle | null } = {
			current: null,
		};
		const written: string[] = [];
		Object.defineProperty(navigator, "clipboard", {
			value: {
				writeText: async (text: string) => {
					written.push(text);
				},
			},
			configurable: true,
		});
		const { events } = await renderEmbed({ ref: handle });

		await act(async () => {
			handle.current?.restart();
		});
		let copied = false;
		await act(async () => {
			copied = (await handle.current?.copyConversation()) ?? false;
		});
		delete (navigator as unknown as Record<string, unknown>).clipboard;

		expect(copied).toBe(true);
		expect(written).toHaveLength(1);
		expect(written[0]).toContain(window.location.hostname);
		expect(
			events
				.map((e) => e.name)
				.filter((name) => name.startsWith("conversation.")),
		).toEqual(["conversation.restarted", "conversation.copied"]);
	});
});
