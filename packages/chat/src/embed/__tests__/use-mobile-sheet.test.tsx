import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";

const win = new Window({ url: "https://shop.example.com" });
for (const key of [
	"document",
	"navigator",
	"HTMLElement",
	"HTMLInputElement",
	"Element",
	"Node",
	"Event",
	"EventTarget",
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

const { act, createElement, useRef } = await import("react");
const { createRoot } = await import("react-dom/client");
const { useMobileSheet } = await import("../use-mobile-sheet");
const { lockDocumentScroll } = await import("../../lib/scroll-lock");
const { hapticTick } = await import("../../lib/haptics");

const TOUCH_QUERY = "(hover: none) and (pointer: coarse)";

/** A stand-in for `window.visualViewport`. */
class FakeViewport extends EventTarget {
	height = 800;
	offsetTop = 0;
	scale = 1;
	move(height: number, offsetTop: number) {
		this.height = height;
		this.offsetTop = offsetTop;
		this.dispatchEvent(new Event("resize"));
	}
}

function touchEvent(type: string, x: number, y: number, target: Element) {
	const event = new win.Event(type, {
		bubbles: true,
		cancelable: true,
		composed: true,
	});
	Object.defineProperty(event, "touches", {
		value: [{ clientX: x, clientY: y }],
	});
	target.dispatchEvent(event as unknown as Event);
	return event;
}

let viewport: FakeViewport;
let container: HTMLElement;
let root: ReturnType<typeof createRoot>;

// Frames run at once, so a viewport event applies before the assertion.
// Swapped in per test and put back after, so other files keep real frames.
const realFrame = globalThis.requestAnimationFrame;
const realCancelFrame = globalThis.cancelAnimationFrame;

beforeEach(() => {
	globalThis.requestAnimationFrame = (run: FrameRequestCallback) => {
		run(0);
		return 0;
	};
	globalThis.cancelAnimationFrame = () => {};
	viewport = new FakeViewport();
	Object.defineProperty(win, "visualViewport", {
		value: viewport,
		configurable: true,
	});
	Object.defineProperty(win, "innerHeight", { value: 800, configurable: true });
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(() => {
	act(() => root.unmount());
	container.remove();
	document.documentElement.style.overflow = "";
	globalThis.requestAnimationFrame = realFrame;
	globalThis.cancelAnimationFrame = realCancelFrame;
});

function Sheet({ active }: { active: boolean }) {
	const ref = useRef<HTMLDivElement>(null);
	useMobileSheet(active, ref);
	return createElement("div", { ref, id: "panel" });
}

function panel(): HTMLElement {
	const el = container.querySelector("#panel");
	if (!(el instanceof win.HTMLElement)) {
		throw new Error("panel not rendered");
	}
	return el as unknown as HTMLElement;
}

describe("useMobileSheet", () => {
	test("sizes the panel to the visual viewport and flags the keyboard", () => {
		act(() => root.render(createElement(Sheet, { active: true })));
		expect(panel().style.getPropertyValue("--ww-vv-height")).toBe("800px");
		expect(panel().hasAttribute("data-keyboard")).toBe(false);

		act(() => viewport.move(460, 120));
		expect(panel().style.getPropertyValue("--ww-vv-height")).toBe("460px");
		expect(panel().style.getPropertyValue("--ww-vv-top")).toBe("120px");
		expect(panel().hasAttribute("data-keyboard")).toBe(true);

		act(() => viewport.move(800, 0));
		expect(panel().hasAttribute("data-keyboard")).toBe(false);
	});

	test("a pinch-zoomed page keeps the plain full-screen layout", () => {
		viewport.scale = 2;
		act(() => root.render(createElement(Sheet, { active: true })));
		expect(panel().style.getPropertyValue("--ww-vv-height")).toBe("");
	});

	test("locks page scrolling while active and lets go when it closes", () => {
		act(() => root.render(createElement(Sheet, { active: true })));
		expect(document.documentElement.style.overflow).toBe("hidden");

		act(() => root.render(createElement(Sheet, { active: false })));
		expect(document.documentElement.style.overflow).toBe("");
		expect(panel().style.getPropertyValue("--ww-vv-height")).toBe("");
	});

	test("does nothing while inactive", () => {
		act(() => root.render(createElement(Sheet, { active: false })));
		expect(document.documentElement.style.overflow).toBe("");
		expect(panel().style.getPropertyValue("--ww-vv-height")).toBe("");
	});
});

describe("lockDocumentScroll", () => {
	test("holds the page until every holder lets go", () => {
		document.documentElement.style.overflow = "clip";
		const first = lockDocumentScroll();
		const second = lockDocumentScroll();
		expect(document.documentElement.style.overflow).toBe("hidden");
		first();
		first();
		expect(document.documentElement.style.overflow).toBe("hidden");
		second();
		expect(document.documentElement.style.overflow).toBe("clip");
	});

	test("cancels a drag that would move the page, keeps one a scroller can take", () => {
		const release = lockDocumentScroll();
		const still = document.createElement("div");
		const scroller = document.createElement("div");
		scroller.style.overflowY = "auto";
		Object.defineProperty(scroller, "scrollHeight", { value: 1000 });
		Object.defineProperty(scroller, "clientHeight", { value: 400 });
		scroller.scrollTop = 200;
		container.append(still, scroller);

		touchEvent("touchstart", 10, 300, still);
		expect(touchEvent("touchmove", 10, 250, still).defaultPrevented).toBe(true);

		touchEvent("touchstart", 10, 300, scroller);
		expect(touchEvent("touchmove", 10, 250, scroller).defaultPrevented).toBe(
			false,
		);

		// At the top, a pull down would chain to the page.
		scroller.scrollTop = 0;
		touchEvent("touchstart", 10, 300, scroller);
		expect(touchEvent("touchmove", 10, 350, scroller).defaultPrevented).toBe(
			true,
		);
		release();
	});
});

describe("hapticTick", () => {
	function withTouch(touch: boolean, run: () => void) {
		const real = win.matchMedia;
		// biome-ignore lint/suspicious/noExplicitAny: happy-dom stub
		(win as any).matchMedia = (query: string) => ({
			...real.call(win, query),
			matches: touch && query === TOUCH_QUERY,
		});
		try {
			run();
		} finally {
			win.matchMedia = real;
		}
	}

	test("vibrates briefly on a touch device that has the Vibration API", () => {
		const calls: number[] = [];
		// biome-ignore lint/suspicious/noExplicitAny: happy-dom stub
		(navigator as any).vibrate = (ms: number) => {
			calls.push(ms);
			return true;
		};
		withTouch(true, hapticTick);
		withTouch(false, hapticTick);
		expect(calls).toEqual([8]);
		// biome-ignore lint/suspicious/noExplicitAny: happy-dom stub
		delete (navigator as any).vibrate;
	});

	test("does nothing where the Vibration API is missing (iOS)", () => {
		expect(() => withTouch(true, hapticTick)).not.toThrow();
	});
});
