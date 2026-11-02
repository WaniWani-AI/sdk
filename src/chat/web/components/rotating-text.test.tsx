import { afterEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";

const win = new Window({ url: "https://shop.example.com" });
for (const key of [
	"document",
	"navigator",
	"HTMLElement",
	"Element",
	"Node",
	"Text",
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
const { RotatingText } = await import("./rotating-text");

let container: HTMLElement;
let root: ReturnType<typeof createRoot>;

afterEach(() => {
	act(() => root?.unmount());
	container?.remove();
});

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function renderRotating(items: string[], intervalMs: number) {
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	await act(async () => {
		root.render(createElement(RotatingText, { items, intervalMs }));
	});
	return () => container.querySelector("span");
}

describe("RotatingText", () => {
	test("cycles items with data-rotating around each swap", async () => {
		const el = await renderRotating(["One", "Two"], 40);
		expect(el()?.textContent).toBe("One");
		expect(el()?.getAttribute("data-rotating")).toBeNull();

		await act(() => wait(60));
		expect(el()?.getAttribute("data-rotating")).toBe("true");

		await act(() => wait(400));
		expect(el()?.textContent).not.toBe("");
		const seen = el()?.textContent;
		expect(seen === "One" || seen === "Two").toBe(true);
	});

	test("swaps to the next item after the fade", async () => {
		const el = await renderRotating(["One", "Two"], 1000);
		await act(() => wait(1350));
		expect(el()?.textContent).toBe("Two");
		expect(el()?.getAttribute("data-rotating")).toBeNull();
	});

	test("a single item never rotates", async () => {
		const el = await renderRotating(["Only"], 20);
		await act(() => wait(80));
		expect(el()?.textContent).toBe("Only");
		expect(el()?.getAttribute("data-rotating")).toBeNull();
	});

	test("an interval of 0 disables rotation", async () => {
		const el = await renderRotating(["One", "Two"], 0);
		await act(() => wait(80));
		expect(el()?.textContent).toBe("One");
		expect(el()?.getAttribute("data-rotating")).toBeNull();
	});

	test("breaks a line on a literal \\n or a newline inside an item", async () => {
		const el = await renderRotating(
			["Financement, conseil :\\non vous oriente", "One\nTwo"],
			1000,
		);
		const span = el();
		expect(span?.querySelectorAll("br").length).toBe(1);
		expect(span?.innerHTML).toBe("Financement, conseil :<br>on vous oriente");

		await act(() => wait(1350));
		expect(el()?.innerHTML).toBe("One<br>Two");
	});
});
