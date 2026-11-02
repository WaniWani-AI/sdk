import { afterEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";

const win = new Window({ url: "https://shop.example.com" });
for (const key of [
	"document",
	"navigator",
	"HTMLElement",
	"HTMLDivElement",
	"Element",
	"Node",
	"Text",
	"Comment",
	"DocumentFragment",
	"Event",
	"MutationObserver",
	"getComputedStyle",
] as const) {
	// biome-ignore lint/suspicious/noExplicitAny: test setup
	(globalThis as any)[key] = (win as any)[key];
}
// biome-ignore lint/suspicious/noExplicitAny: test setup
(globalThis as any).window = win;
// biome-ignore lint/suspicious/noExplicitAny: test setup
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const { act, createElement } = await import("react");
const { createRoot } = await import("react-dom/client");
const { ChainOfThought } = await import("./chain-of-thought");

let container: HTMLElement;
let root: ReturnType<typeof createRoot>;

afterEach(() => {
	act(() => root?.unmount());
	container?.remove();
});

function renderChain(isWorking: boolean) {
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	act(() => {
		root.render(createElement(ChainOfThought, { isWorking }));
	});
	return container.querySelector(".ww-reasoning");
}

describe("ChainOfThought hooks", () => {
	test("exposes data-streaming while the chain is working", () => {
		const chain = renderChain(true);
		expect(chain?.getAttribute("data-streaming")).toBe("true");
		expect(chain?.getAttribute("data-state")).toBe("closed");
	});

	test("drops data-streaming once the chain is done", () => {
		const chain = renderChain(false);
		expect(chain?.hasAttribute("data-streaming")).toBe(false);
	});
});
