import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { Window } from "happy-dom";

// biome-ignore lint/suspicious/noExplicitAny: test setup
(globalThis as any).indexedDB = new IDBFactory();
// biome-ignore lint/suspicious/noExplicitAny: test setup
(globalThis as any).IDBKeyRange = IDBKeyRange;

const win = new Window({ url: "https://localhost" });
for (const key of [
	"document",
	"navigator",
	"HTMLElement",
	"HTMLDivElement",
	"HTMLAnchorElement",
	"HTMLButtonElement",
	"HTMLTextAreaElement",
	"HTMLDialogElement",
	"HTMLScriptElement",
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
	"sessionStorage",
	"localStorage",
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

const { act, createElement, Fragment, useState } = await import("react");
const { createRoot } = await import("react-dom/client");
type Root = ReturnType<typeof createRoot>;

// A stateful stand-in for `useChat`: `setMessages` really changes what the
// chat renders, so "New chat clears the conversation" is observable in the DOM.
let seedMessages: unknown[] = [];

// @ts-expect-error -- bun:test `mock.module` exists at runtime but has no TS type
mock.module("@ai-sdk/react", () => ({
	useChat() {
		const [messages, setMessages] = useState<unknown[]>(seedMessages);
		return {
			messages,
			sendMessage: () => {},
			setMessages,
			status: "ready",
			stop: async () => {},
			addToolOutput: () => {},
		};
	},
}));

// @ts-expect-error -- bun:test `mock.module` exists at runtime but has no TS type
mock.module("../../lib/lenient-chat-transport", () => ({
	LenientChatTransport: class {},
}));

const originalFetch = globalThis.fetch;
beforeEach(() => {
	globalThis.fetch = mock(async (input: unknown) =>
		String(input).includes("/tools")
			? Response.json({ tools: [] })
			: new Response("not found", { status: 404 }),
	) as unknown as typeof fetch;
	seedMessages = [];
	try {
		window.sessionStorage.clear();
	} catch {}
});
afterEach(() => {
	globalThis.fetch = originalFetch;
});

const { WaniwaniChat } = await import("../waniwani-chat");
const { ChatEmbed } = await import("../chat-embed");
const { PARTS } = await import("../../parts");

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

type ChatProps = Parameters<typeof WaniwaniChat>[0];
type Overrides = NonNullable<ChatProps["overrides"]>;

async function flush() {
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 20));
	});
}

async function renderChat(overrides: Overrides = {}) {
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	await act(async () => {
		root?.render(
			createElement(WaniwaniChat, {
				token: "wwp_test",
				channelId: "chan_1",
				overrides: { locale: "en", disablePageView: true, ...overrides },
			}),
		);
	});
	await flush();
	return container;
}

async function rerenderChat(overrides: Overrides = {}) {
	await act(async () => {
		root?.render(
			createElement(WaniwaniChat, {
				token: "wwp_test",
				channelId: "chan_1",
				overrides: { locale: "en", disablePageView: true, ...overrides },
			}),
		);
	});
	await flush();
}

const headerSelector = `.${PARTS.header}`;

function header(el: HTMLElement): HTMLElement | null {
	return el.querySelector<HTMLElement>(headerSelector);
}

function requireHeader(el: HTMLElement): HTMLElement {
	const found = header(el);
	if (!found) {
		throw new Error("no sticky header rendered");
	}
	return found;
}

function button(el: HTMLElement, label: string): HTMLButtonElement {
	const found = el.querySelector<HTMLButtonElement>(
		`button[aria-label="${label}"]`,
	);
	if (!found) {
		throw new Error(`no button labelled ${label}`);
	}
	return found;
}

function precedes(a: Node, b: Node): boolean {
	// biome-ignore lint/suspicious/noExplicitAny: happy-dom constant
	const following = (Node as any).DOCUMENT_POSITION_FOLLOWING;
	return (a.compareDocumentPosition(b) & following) !== 0;
}

const action = (id: string, text = id) =>
	createElement("button", { type: "button", "data-testid": id }, text);

describe("WaniwaniChat overrides.headerActions", () => {
	test("without a title or thread history, no header renders at all (baseline)", async () => {
		const el = await renderChat();
		expect(header(el)).toBeNull();
	});

	test("headerActions alone makes the header appear and puts the node inside it", async () => {
		const el = await renderChat({ headerActions: action("close", "Close") });
		const h = requireHeader(el);
		const node = el.querySelector('[data-testid="close"]');
		expect(node).not.toBeNull();
		expect(h.contains(node)).toBe(true);
		expect(node?.textContent).toBe("Close");
	});

	test("the node renders exactly once in the whole chat", async () => {
		const el = await renderChat({ headerActions: action("close") });
		expect(el.querySelectorAll('[data-testid="close"]').length).toBe(1);
	});

	test("hideHeader: true hides the header and the actions with it", async () => {
		const el = await renderChat({
			hideHeader: true,
			headerActions: action("close"),
		});
		expect(header(el)).toBeNull();
		expect(el.querySelector('[data-testid="close"]')).toBeNull();
	});

	test("hideHeader: true with title, thread history and actions still hides everything", async () => {
		const el = await renderChat({
			hideHeader: true,
			title: "Support",
			enableThreadHistory: true,
			headerActions: action("close"),
		});
		expect(header(el)).toBeNull();
		expect(el.querySelector('[data-testid="close"]')).toBeNull();
		expect(el.querySelector('button[aria-label="New chat"]')).toBeNull();
	});

	test("with thread history, the actions come after New chat and Thread history in the same header", async () => {
		const el = await renderChat({
			enableThreadHistory: true,
			headerActions: action("close"),
		});
		const h = requireHeader(el);
		const newChat = button(el, "New chat");
		const history = button(el, "Thread history");
		const node = el.querySelector('[data-testid="close"]');
		if (!node) {
			throw new Error("action node missing");
		}
		expect(h.contains(newChat)).toBe(true);
		expect(h.contains(history)).toBe(true);
		expect(h.contains(node)).toBe(true);
		expect(precedes(newChat, node)).toBe(true);
		expect(precedes(history, node)).toBe(true);
	});

	test("the actions are the last control in the header row", async () => {
		const el = await renderChat({
			enableThreadHistory: true,
			title: "Support",
			headerActions: action("close"),
		});
		const h = requireHeader(el);
		const buttons = Array.from(h.querySelectorAll("button")).filter(
			(b) => b.closest('[role="menu"]') === null,
		);
		expect(buttons.at(-1)?.getAttribute("data-testid")).toBe("close");
	});

	test("with a title, the title stays and precedes the actions", async () => {
		const el = await renderChat({
			title: "Support",
			headerActions: action("close"),
		});
		const h = requireHeader(el);
		const title = h.querySelector(`.${PARTS.headerTitle}`);
		const node = h.querySelector('[data-testid="close"]');
		if (!title || !node) {
			throw new Error("title or action missing");
		}
		expect(title.textContent).toBe("Support");
		expect(precedes(title, node)).toBe(true);
	});

	test("several nodes in a fragment all render in the header, in order", async () => {
		const el = await renderChat({
			headerActions: createElement(
				Fragment,
				null,
				action("first"),
				action("second"),
			),
		});
		const h = requireHeader(el);
		const first = h.querySelector('[data-testid="first"]');
		const second = h.querySelector('[data-testid="second"]');
		if (!first || !second) {
			throw new Error("fragment children missing");
		}
		expect(precedes(first, second)).toBe(true);
	});

	test("a plain string as headerActions renders inside the header", async () => {
		const el = await renderChat({ headerActions: "Beta" });
		const h = requireHeader(el);
		expect(h.textContent).toContain("Beta");
	});

	test("an interactive action keeps working inside the header", async () => {
		function Counter() {
			const [count, setCount] = useState(0);
			return createElement(
				"button",
				{
					type: "button",
					"data-testid": "counter",
					onClick: () => setCount((c) => c + 1),
				},
				`clicked ${count}`,
			);
		}
		const el = await renderChat({ headerActions: createElement(Counter) });
		const counter = el.querySelector<HTMLButtonElement>(
			'[data-testid="counter"]',
		);
		await act(async () => {
			counter?.click();
		});
		await act(async () => {
			counter?.click();
		});
		expect(counter?.textContent).toBe("clicked 2");
	});

	test("adding headerActions on a rerender shows the header; removing it hides it again", async () => {
		const el = await renderChat();
		expect(header(el)).toBeNull();

		await rerenderChat({ headerActions: action("close") });
		expect(header(el)).not.toBeNull();
		expect(
			requireHeader(el).querySelector('[data-testid="close"]'),
		).not.toBeNull();

		await rerenderChat();
		expect(header(el)).toBeNull();
		expect(el.querySelector('[data-testid="close"]')).toBeNull();
	});

	test("swapping the headerActions node replaces what the header shows", async () => {
		const el = await renderChat({ headerActions: action("a") });
		await rerenderChat({ headerActions: action("b") });
		const h = requireHeader(el);
		expect(h.querySelector('[data-testid="a"]')).toBeNull();
		expect(h.querySelector('[data-testid="b"]')).not.toBeNull();
	});

	test("headerActions={null} behaves as unset: no header", async () => {
		const el = await renderChat({ headerActions: null });
		expect(header(el)).toBeNull();
	});

	test("headerActions={false} behaves as unset: no header", async () => {
		const el = await renderChat({ headerActions: false });
		expect(header(el)).toBeNull();
	});

	test("without headerActions, a titled header holds no actions wrapper and only the title text", async () => {
		const el = await renderChat({ title: "Support" });
		const h = requireHeader(el);
		expect(h.querySelector(`.${PARTS.headerActions}`)).toBeNull();
		expect(h.textContent).toBe("Support");
		expect(h.querySelectorAll("button").length).toBe(0);
	});

	test("without headerActions, thread history renders exactly New chat and Thread history", async () => {
		const el = await renderChat({ enableThreadHistory: true });
		const h = requireHeader(el);
		expect(h.querySelector(`.${PARTS.headerActions}`)).toBeNull();
		const labels = Array.from(h.querySelectorAll("button")).map((b) =>
			b.getAttribute("aria-label"),
		);
		expect(labels).toEqual(["New chat", "Thread history"]);
	});

	test("adding headerActions leaves the built-in header buttons unchanged", async () => {
		const el = await renderChat({ enableThreadHistory: true });
		const before = Array.from(requireHeader(el).querySelectorAll("button")).map(
			(b) => b.getAttribute("aria-label"),
		);
		await rerenderChat({
			enableThreadHistory: true,
			headerActions: action("close", "X"),
		});
		const after = Array.from(requireHeader(el).querySelectorAll("button"))
			.filter((b) => b.getAttribute("data-testid") !== "close")
			.map((b) => b.getAttribute("aria-label"));
		expect(after).toEqual(before);
	});
});

describe("WaniwaniChat header buttons", () => {
	test("New chat and Thread history carry an aria-label and no title attribute", async () => {
		const el = await renderChat({ enableThreadHistory: true });
		for (const label of ["New chat", "Thread history"]) {
			const b = button(el, label);
			expect(b.hasAttribute("title")).toBe(false);
		}
	});

	test("their icons are hidden from assistive tech and carry no name of their own", async () => {
		const el = await renderChat({ enableThreadHistory: true });
		for (const label of ["New chat", "Thread history"]) {
			const b = button(el, label);
			const svgs = Array.from(b.querySelectorAll("svg"));
			expect(svgs.length).toBeGreaterThan(0);
			for (const svg of svgs) {
				expect(svg.getAttribute("aria-hidden")).toBe("true");
				expect(svg.hasAttribute("aria-label")).toBe(false);
				expect(svg.querySelector("title")).toBeNull();
			}
			// No visible or hidden text inside the button that a screen reader
			// would read in addition to the aria-label.
			expect(b.textContent).toBe("");
		}
	});

	test("in French the labels are localized", async () => {
		const el = await renderChat({ enableThreadHistory: true, locale: "fr" });
		const h = requireHeader(el);
		const labels = Array.from(h.querySelectorAll("button")).map((b) =>
			b.getAttribute("aria-label"),
		);
		expect(labels).toEqual(["Nouvelle conversation", "Historique"]);
		for (const b of Array.from(h.querySelectorAll("button"))) {
			expect(b.hasAttribute("title")).toBe(false);
		}
	});

	test("in Spanish the labels are localized", async () => {
		const el = await renderChat({ enableThreadHistory: true, locale: "es" });
		const labels = Array.from(requireHeader(el).querySelectorAll("button")).map(
			(b) => b.getAttribute("aria-label"),
		);
		expect(labels).toEqual(["Nueva conversación", "Historial"]);
	});

	test("message overrides for the thread menu labels reach the aria-label", async () => {
		const el = await renderChat({ enableThreadHistory: true });
		await act(async () => {
			root?.render(
				createElement(WaniwaniChat, {
					token: "wwp_test",
					channelId: "chan_1",
					overrides: {
						locale: "en",
						disablePageView: true,
						enableThreadHistory: true,
						messages: {
							threadMenu: { newChat: "Start over", threadHistory: "Past" },
						},
					},
				}),
			);
		});
		await flush();
		expect(button(el, "Start over").hasAttribute("title")).toBe(false);
		expect(button(el, "Past").hasAttribute("title")).toBe(false);
	});

	test("the history button toggles aria-expanded and its menu", async () => {
		const el = await renderChat({ enableThreadHistory: true });
		const history = button(el, "Thread history");
		expect(history.getAttribute("aria-expanded")).toBe("false");
		expect(el.querySelector('[role="menu"]')).toBeNull();

		await act(async () => {
			history.click();
		});
		expect(history.getAttribute("aria-expanded")).toBe("true");
		expect(el.querySelector('[role="menu"]')).not.toBeNull();

		await act(async () => {
			history.click();
		});
		expect(history.getAttribute("aria-expanded")).toBe("false");
		expect(el.querySelector('[role="menu"]')).toBeNull();
	});

	test("clicking New chat clears the conversation on screen", async () => {
		seedMessages = [
			{
				id: "m1",
				role: "user",
				parts: [{ type: "text", text: "unique-seeded-question" }],
			},
		];
		const el = await renderChat({ enableThreadHistory: true });
		expect(el.textContent).toContain("unique-seeded-question");

		await act(async () => {
			button(el, "New chat").click();
		});
		await flush();
		expect(el.textContent).not.toContain("unique-seeded-question");
	});

	test("clicking New chat with headerActions set still clears the conversation", async () => {
		seedMessages = [
			{
				id: "m1",
				role: "user",
				parts: [{ type: "text", text: "another-seeded-question" }],
			},
		];
		const el = await renderChat({
			enableThreadHistory: true,
			headerActions: action("close"),
		});
		expect(el.textContent).toContain("another-seeded-question");
		await act(async () => {
			button(el, "New chat").click();
		});
		await flush();
		expect(el.textContent).not.toContain("another-seeded-question");
		expect(el.querySelector('[data-testid="close"]')).not.toBeNull();
	});
});

describe("WaniwaniChat standalone New chat (session kept, no thread history)", () => {
	const sessionApi = "https://localhost/api/mcp/agent/session";

	test("the header shows one New chat button, labelled, without title, icon hidden", async () => {
		const el = await renderChat({ sessionApi });
		const h = requireHeader(el);
		const labels = Array.from(h.querySelectorAll("button")).map((b) =>
			b.getAttribute("aria-label"),
		);
		expect(labels).toEqual(["New chat"]);
		const b = button(el, "New chat");
		expect(b.hasAttribute("title")).toBe(false);
		for (const svg of Array.from(b.querySelectorAll("svg"))) {
			expect(svg.getAttribute("aria-hidden")).toBe("true");
			expect(svg.querySelector("title")).toBeNull();
		}
		expect(b.textContent).toBe("");
	});

	test("headerActions sit after the standalone New chat button", async () => {
		const el = await renderChat({ sessionApi, headerActions: action("close") });
		const h = requireHeader(el);
		const node = h.querySelector('[data-testid="close"]');
		if (!node) {
			throw new Error("action node missing");
		}
		expect(precedes(button(el, "New chat"), node)).toBe(true);
	});

	test("clicking the standalone New chat resets the conversation", async () => {
		seedMessages = [
			{
				id: "m1",
				role: "user",
				parts: [{ type: "text", text: "kept-session-question" }],
			},
		];
		const el = await renderChat({ sessionApi });
		expect(el.textContent).toContain("kept-session-question");
		await act(async () => {
			button(el, "New chat").click();
		});
		await flush();
		expect(el.textContent).not.toContain("kept-session-question");
	});
});

describe("ChatEmbed header with the actions menu", () => {
	async function renderEmbed(
		props: Partial<Parameters<typeof ChatEmbed>[0]> = {},
	) {
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
		await flush();
		return container;
	}

	test("the More actions button has its label, no title, and an aria-hidden icon", async () => {
		const el = await renderEmbed({ menu: ["new-chat", "restart"] });
		const more = button(el, "More actions");
		expect(more.hasAttribute("title")).toBe(false);
		const svgs = Array.from(more.querySelectorAll("svg"));
		expect(svgs.length).toBeGreaterThan(0);
		for (const svg of svgs) {
			expect(svg.getAttribute("aria-hidden")).toBe("true");
			expect(svg.querySelector("title")).toBeNull();
		}
		expect(more.textContent).toBe("");
	});

	test("the More actions label is localized in French", async () => {
		const el = await renderEmbed({ menu: ["restart"], locale: "fr" });
		expect(button(el, "Autres actions").hasAttribute("title")).toBe(false);
	});

	test("headerActions come after the More actions button in the header", async () => {
		const el = await renderEmbed({
			menu: ["new-chat", "restart"],
			headerActions: action("close"),
		});
		const h = requireHeader(el);
		const more = button(el, "More actions");
		const node = h.querySelector('[data-testid="close"]');
		if (!node) {
			throw new Error("action node missing");
		}
		expect(h.contains(more)).toBe(true);
		expect(precedes(more, node)).toBe(true);
	});

	test("the More actions button toggles aria-expanded", async () => {
		const el = await renderEmbed({ menu: ["new-chat", "restart"] });
		const more = button(el, "More actions");
		expect(more.getAttribute("aria-expanded")).toBe("false");
		await act(async () => {
			more.click();
		});
		expect(more.getAttribute("aria-expanded")).toBe("true");
	});
});
