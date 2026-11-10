import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	test,
} from "bun:test";
import { Window } from "happy-dom";

const win = new Window({ url: "https://localhost" });
Reflect.set(globalThis, "window", win);
for (const key of [
	"document",
	"navigator",
	"HTMLElement",
	"HTMLDivElement",
	"HTMLTextAreaElement",
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
]) {
	Reflect.set(globalThis, key, Reflect.get(win, key));
}

Object.defineProperty(win.HTMLTextAreaElement.prototype, "scrollHeight", {
	configurable: true,
	get(this: HTMLTextAreaElement) {
		return this.parentElement?.dataset.multiline === "true" ? 20 : 40;
	},
});

const { createElement, useRef } = await import("react");
const { flushSync } = await import("react-dom");
const { createRoot } = await import("react-dom/client");
const { useMultiline } = await import("../use-multiline");

const previousActEnvironment = Reflect.get(
	globalThis,
	"IS_REACT_ACT_ENVIRONMENT",
);
beforeAll(() => {
	Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", false);
});
afterAll(() => {
	Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", previousActEnvironment);
});

const seen: boolean[] = [];

function Harness({ text }: { text: string }) {
	const row = useRef<HTMLDivElement>(null);
	const multiline = useMultiline(row, text);
	seen.push(multiline);
	return createElement(
		"div",
		{ ref: row, "data-multiline": String(multiline) },
		createElement("textarea", {
			value: text,
			readOnly: true,
			style: { lineHeight: "20px" },
		}),
	);
}

const container = document.createElement("div");
document.body.appendChild(container);
const root = createRoot(container);

afterEach(() => {
	flushSync(() => {
		root.render(null);
	});
	seen.length = 0;
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("useMultiline", () => {
	test("flags a wrapped text once when the multi-line layout makes it fit on one line", async () => {
		flushSync(() => {
			root.render(createElement(Harness, { text: "a".repeat(45) }));
		});
		await sleep(50);

		expect(seen).toEqual([false, true]);
		expect(container.firstElementChild?.getAttribute("data-multiline")).toBe(
			"true",
		);
	});
});
