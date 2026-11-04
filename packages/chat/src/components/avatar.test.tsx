import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";

const win = new Window({ url: "https://shop.example.com" });
for (const key of [
	"document",
	"navigator",
	"HTMLElement",
	"HTMLImageElement",
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

let reducedMotion = false;
// biome-ignore lint/suspicious/noExplicitAny: test setup
(globalThis as any).matchMedia = () => ({ matches: reducedMotion });

const { act, createElement } = await import("react");
const { createRoot } = await import("react-dom/client");
const { Avatar, resetAvatarIntros } = await import("./avatar");
type AvatarSlot = Parameters<typeof Avatar>[0]["slot"];

const STILL = "https://cdn.example.com/face.svg";
const INTRO = { src: "https://cdn.example.com/face.webp", durationMs: 20 };

let container: HTMLElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
	reducedMotion = false;
	resetAvatarIntros();
});

afterEach(() => {
	act(() => root?.unmount());
	container?.remove();
});

function render(slot: AvatarSlot, visible = true) {
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	act(() => {
		root.render(
			createElement(Avatar, { src: STILL, slot, intro: INTRO, visible }),
		);
	});
	return container.querySelector("img") as HTMLImageElement;
}

function rerender(slot: AvatarSlot, visible: boolean) {
	act(() => {
		root.render(
			createElement(Avatar, { src: STILL, slot, intro: INTRO, visible }),
		);
	});
	return container.querySelector("img") as HTMLImageElement;
}

function fire(img: HTMLImageElement, type: "load" | "error") {
	act(() => {
		img.dispatchEvent(new Event(type));
	});
}

const wait = (ms: number) => act(() => new Promise((r) => setTimeout(r, ms)));

describe("Avatar intro", () => {
	test("plays the intro once it loads, then shows the still image", async () => {
		const img = render("welcome");
		expect(img.getAttribute("src")).toBe(INTRO.src);
		expect(img.getAttribute("data-intro")).toBe("true");

		await wait(40);
		expect(img.getAttribute("src")).toBe(INTRO.src);

		fire(img, "load");
		await wait(40);
		expect(img.getAttribute("src")).toBe(STILL);
		expect(img.hasAttribute("data-intro")).toBe(false);
	});

	test("plays once per slot and page load", () => {
		const first = render("dock");
		expect(first.getAttribute("src")).toBe(INTRO.src);
		act(() => root.unmount());
		container.remove();

		expect(render("dock").getAttribute("src")).toBe(STILL);
		act(() => root.unmount());
		container.remove();

		expect(render("composer").getAttribute("src")).toBe(INTRO.src);
	});

	test("waits until the slot is visible, then plays", async () => {
		const img = render("welcome", false);
		expect(img.getAttribute("src")).toBe(STILL);
		expect(img.hasAttribute("data-intro")).toBe(false);

		const shown = rerender("welcome", true);
		expect(shown.getAttribute("src")).toBe(INTRO.src);
		expect(shown.getAttribute("data-intro")).toBe("true");

		fire(shown, "load");
		await wait(40);
		expect(shown.getAttribute("src")).toBe(STILL);
	});

	test("a slot that waited does not play if another already did", () => {
		render("welcome", false);
		const other = document.createElement("div");
		document.body.appendChild(other);
		const otherRoot = createRoot(other);
		act(() => {
			otherRoot.render(
				createElement(Avatar, { src: STILL, slot: "welcome", intro: INTRO }),
			);
		});
		expect(other.querySelector("img")?.getAttribute("src")).toBe(INTRO.src);
		act(() => otherRoot.unmount());
		other.remove();

		expect(rerender("welcome", true).getAttribute("src")).toBe(STILL);
	});

	test("never plays in the message slot", () => {
		const img = render("message");
		expect(img.getAttribute("src")).toBe(STILL);
		expect(img.hasAttribute("data-intro")).toBe(false);
	});

	test("shows the still image under reduced motion", () => {
		reducedMotion = true;
		expect(render("welcome").getAttribute("src")).toBe(STILL);
	});

	test("falls back to the still image when the intro fails to load", () => {
		const img = render("welcome");
		fire(img, "error");
		expect(img.getAttribute("src")).toBe(STILL);
		fire(img, "error");
		expect(container.querySelector("img")).toBeNull();
	});
});
