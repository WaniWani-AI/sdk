import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { Window } from "happy-dom";

const win = new Window({
	url: "https://shop.example.com/pricing",
	settings: {
		disableIframePageLoading: true,
		disableJavaScriptFileLoading: true,
		disableCSSFileLoading: true,
	},
});
const DOM_GLOBALS = [
	"document",
	"navigator",
	"localStorage",
	"sessionStorage",
	"location",
	"HTMLElement",
	"HTMLDivElement",
	"HTMLIFrameElement",
	"HTMLButtonElement",
	"HTMLAnchorElement",
	"HTMLTextAreaElement",
	"HTMLInputElement",
	"HTMLScriptElement",
	"Element",
	"Node",
	"Text",
	"Comment",
	"DocumentFragment",
	"ShadowRoot",
	"Event",
	"CustomEvent",
	"KeyboardEvent",
	"MouseEvent",
	"MutationObserver",
	"IntersectionObserver",
	"ResizeObserver",
	"customElements",
	"requestAnimationFrame",
	"cancelAnimationFrame",
	"getComputedStyle",
] as const;
for (const key of DOM_GLOBALS) {
	Object.assign(globalThis, { [key]: Reflect.get(win, key) });
}
Object.assign(globalThis, {
	window: win,
	IS_REACT_ACT_ENVIRONMENT: true,
	indexedDB: new IDBFactory(),
	IDBKeyRange,
});
Object.assign(win, { SyntaxError });

const REAL_FETCH = globalThis.fetch;

const { act } = await import("react");
// Fresh module instance: another suite may already have installed the embed on its own window.
await import(`../embed?container-appearance=${Date.now()}`);

const API = "https://api.example.test/api/mcp/chat";

function chat() {
	const api = window.WaniWani?.chat;
	if (!api) {
		throw new Error("embed did not install WaniWani.chat");
	}
	return api;
}

const consoleSpies: Array<{ mockRestore: () => void }> = [];

beforeEach(() => {
	globalThis.fetch = Object.assign(async () => Response.json({}), {
		preconnect: REAL_FETCH.preconnect,
	});
	consoleSpies.push(
		spyOn(console, "info").mockImplementation(() => {}),
		spyOn(console, "warn").mockImplementation(() => {}),
	);
});

afterEach(() => {
	act(() => {
		chat().destroy();
	});
	for (const el of document.querySelectorAll("[data-waniwani-embed]")) {
		el.remove();
	}
	globalThis.fetch = REAL_FETCH;
	for (const spy of consoleSpies.splice(0)) {
		spy.mockRestore();
	}
});

async function mountInline(
	variables: Record<string, unknown>,
): Promise<HTMLElement> {
	const container = document.createElement("div");
	container.setAttribute("data-waniwani-embed", "");
	document.body.appendChild(container);
	await act(async () => {
		chat().init({
			api: API,
			token: "wwp_abc123",
			mode: "inline",
			appearance: { variables },
		});
		await new Promise((resolve) => setTimeout(resolve, 20));
	});
	return container;
}

describe("init container appearance", () => {
	test("appearance.variables.borderRadius reaches the container as --ww-radius", async () => {
		const container = await mountInline({ borderRadius: 8 });
		expect(container.style.getPropertyValue("--ww-radius")).toBe("8px");
	});

	test("borderRadius 0 still bridges, next to borderWidth", async () => {
		const container = await mountInline({ borderRadius: 0, borderWidth: 2 });
		expect(container.style.getPropertyValue("--ww-radius")).toBe("0px");
		expect(container.style.getPropertyValue("--ww-border-width")).toBe("2px");
	});

	test("no borderRadius leaves the container radius to the stylesheet default", async () => {
		const container = await mountInline({ borderWidth: 1 });
		expect(container.style.getPropertyValue("--ww-radius")).toBe("");
	});
});
