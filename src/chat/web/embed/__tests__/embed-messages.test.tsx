import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";

const win = new Window({ url: "https://shop.example.com/pricing" });
for (const key of [
	"document",
	"navigator",
	"localStorage",
	"sessionStorage",
	"screen",
	"location",
	"HTMLElement",
	"HTMLDivElement",
	"HTMLFormElement",
	"HTMLInputElement",
	"HTMLTextAreaElement",
	"Element",
	"Node",
	"Text",
	"Comment",
	"DocumentFragment",
	"Event",
	"CustomEvent",
	"KeyboardEvent",
	"MouseEvent",
	"PointerEvent",
	"MutationObserver",
	"IntersectionObserver",
	"ResizeObserver",
	"customElements",
	"matchMedia",
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
const { FloatingChat } = await import("../floating-chat");
const { ComposerChat } = await import("../composer-chat");
const { InlineChat } = await import("../inline-chat");
type EmbedConfig = import("../config").EmbedConfig;

const MESSAGES_URL = "https://shop.example.com/messages.json";
const FR = {
	promptInput: { submit: "Poser la question" },
	launcher: { close: "Fermer l'assistant" },
};

const CONFIG: EmbedConfig = {
	token: "wwp_test",
	api: "https://brand.mock/api/chat",
	appearDelay: 0,
	locale: "fr",
};

const realFetch = globalThis.fetch;
const realRequestAnimationFrame = globalThis.requestAnimationFrame;
let container: HTMLElement;
let root: ReturnType<typeof createRoot>;
let panelContainer: HTMLElement;
let fetched: string[] = [];

beforeEach(() => {
	globalThis.requestAnimationFrame = (() => 0) as typeof requestAnimationFrame;
	fetched = [];
	globalThis.fetch = (async (url: unknown) => {
		fetched.push(String(url));
		const body = String(url) === MESSAGES_URL ? { fr: FR } : {};
		return Response.json(body);
	}) as unknown as typeof fetch;
	container = document.createElement("div");
	document.body.appendChild(container);
	panelContainer = document.createElement("div");
	document.body.appendChild(panelContainer);
	root = createRoot(container);
});

afterEach(() => {
	act(() => root.unmount());
	container.remove();
	panelContainer.remove();
	globalThis.fetch = realFetch;
	globalThis.requestAnimationFrame = realRequestAnimationFrame;
});

async function renderSettled(element: ReturnType<typeof createElement>) {
	await act(async () => {
		root.render(element);
	});
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 20));
	});
}

const sendLabel = (scope: ParentNode) =>
	scope.querySelector(".ww-send")?.getAttribute("aria-label");
const closeLabel = (scope: ParentNode) =>
	scope.querySelector(".ww-panel .ww-close")?.getAttribute("aria-label");

describe("wording overrides reach every mode", () => {
	test("floating: the dock chrome and the panel both read the tag's map", async () => {
		await renderSettled(
			createElement(FloatingChat, {
				config: { ...CONFIG, mode: "floating", messages: { fr: FR } },
			}),
		);
		expect(sendLabel(container)).toBe(FR.promptInput.submit);
		expect(closeLabel(container)).toBe(FR.launcher.close);
	});

	test("composer: the portalled panel reads the tag's map", async () => {
		await renderSettled(
			createElement(ComposerChat, {
				config: { ...CONFIG, mode: "composer", messages: { fr: FR } },
				panelContainer,
			}),
		);
		expect(sendLabel(panelContainer)).toBe(FR.promptInput.submit);
		expect(closeLabel(panelContainer)).toBe(FR.launcher.close);
	});

	test("inline: the chat reads the tag's map", async () => {
		await renderSettled(
			createElement(InlineChat, {
				config: { ...CONFIG, mode: "inline", messages: FR },
			}),
		);
		expect(sendLabel(container)).toBe(FR.promptInput.submit);
	});

	test("a map from data-messages-url applies, the inline map wins per key", async () => {
		await renderSettled(
			createElement(FloatingChat, {
				config: {
					...CONFIG,
					mode: "floating",
					messagesUrl: MESSAGES_URL,
					messages: { fr: { launcher: { close: "Fermer" } } },
				},
			}),
		);
		expect(fetched).toContain(MESSAGES_URL);
		expect(sendLabel(container)).toBe(FR.promptInput.submit);
		expect(closeLabel(container)).toBe("Fermer");
	});

	test("no wording attribute fetches no messages file and keeps the catalog", async () => {
		await renderSettled(
			createElement(FloatingChat, { config: { ...CONFIG, mode: "floating" } }),
		);
		expect(fetched).not.toContain(MESSAGES_URL);
		expect(sendLabel(container)).toBe("Envoyer");
	});
});
