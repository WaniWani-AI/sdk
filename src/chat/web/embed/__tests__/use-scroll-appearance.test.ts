import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";

// ---------------------------------------------------------------------------
// DOM setup before importing React (mirrors use-chat-engine.test.tsx)
// ---------------------------------------------------------------------------

const win = new Window({ url: "https://localhost" });
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
	"CustomEvent",
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
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// ---------------------------------------------------------------------------
// Controllable IntersectionObserver + querySelector
// ---------------------------------------------------------------------------

type IOEntry = {
	isIntersecting: boolean;
	boundingClientRect: { bottom: number };
};
let ioCallback: ((entries: IOEntry[]) => void) | null = null;
let observedCount = 0;

class MockIntersectionObserver {
	constructor(cb: (entries: IOEntry[]) => void) {
		ioCallback = cb;
	}
	observe() {
		observedCount += 1;
	}
	disconnect() {}
	unobserve() {}
	takeRecords() {
		return [];
	}
}
// Capture originals so we can restore them and not leak into other test files
// (bun runs the suite in one shared process).
// biome-ignore lint/suspicious/noExplicitAny: test setup
const originalIO = (globalThis as any).IntersectionObserver;
// biome-ignore lint/suspicious/noExplicitAny: test setup
const originalQuerySelector = (globalThis as any).document.querySelector;
// biome-ignore lint/suspicious/noExplicitAny: test setup
(globalThis as any).IntersectionObserver = MockIntersectionObserver;

// Swap in a controllable querySelector so tests decide "found" / "missing" /
// "invalid selector" without depending on happy-dom's CSS engine.
let querySelectorImpl: (selector: string) => Element | null = () =>
	({}) as Element;
// biome-ignore lint/suspicious/noExplicitAny: test setup
(globalThis as any).document.querySelector = (selector: string) =>
	querySelectorImpl(selector);

afterAll(() => {
	// biome-ignore lint/suspicious/noExplicitAny: test teardown
	(globalThis as any).IntersectionObserver = originalIO;
	// biome-ignore lint/suspicious/noExplicitAny: test teardown
	(globalThis as any).document.querySelector = originalQuerySelector;
});

const { act, createElement } = await import("react");
const { createRoot } = await import("react-dom/client");
const { useScrollAppearance } = await import("../use-scroll-appearance");

// Render harness: mount a probe that surfaces the hook's return value.
async function mount(selector: string | null) {
	const container = win.document.createElement("div");
	let latest = false;
	function Probe() {
		latest = useScrollAppearance(selector);
		return null;
	}
	// biome-ignore lint/suspicious/noExplicitAny: happy-dom Element vs DOM Element
	const root = createRoot(container as any);
	await act(async () => {
		root.render(createElement(Probe));
	});
	return {
		get value() {
			return latest;
		},
		async fire(entry: IOEntry) {
			await act(async () => {
				ioCallback?.([entry]);
			});
		},
		unmount() {
			act(() => root.unmount());
		},
	};
}

beforeEach(() => {
	ioCallback = null;
	observedCount = 0;
	querySelectorImpl = () => ({}) as Element;
});

describe("useScrollAppearance", () => {
	test("returns false and observes nothing when selector is null", async () => {
		const h = await mount(null);
		expect(h.value).toBe(false);
		expect(observedCount).toBe(0);
		h.unmount();
	});

	test("stays hidden while the target element is in view", async () => {
		const h = await mount("#hero");
		expect(observedCount).toBe(1);
		await h.fire({ isIntersecting: true, boundingClientRect: { bottom: 400 } });
		expect(h.value).toBe(false);
		h.unmount();
	});

	test("reveals once the element is scrolled above the viewport", async () => {
		const h = await mount("#hero");
		await h.fire({
			isIntersecting: false,
			boundingClientRect: { bottom: -20 },
		});
		expect(h.value).toBe(true);
		h.unmount();
	});

	test("stays hidden while the element is still below the fold", async () => {
		const h = await mount("#hero");
		await h.fire({
			isIntersecting: false,
			boundingClientRect: { bottom: 900 },
		});
		expect(h.value).toBe(false);
		h.unmount();
	});

	test("hides again reactively when scrolled back up into view", async () => {
		const h = await mount("#hero");
		await h.fire({
			isIntersecting: false,
			boundingClientRect: { bottom: -20 },
		});
		expect(h.value).toBe(true);
		await h.fire({ isIntersecting: true, boundingClientRect: { bottom: 300 } });
		expect(h.value).toBe(false);
		h.unmount();
	});

	test("fails open (shows) on an invalid selector", async () => {
		querySelectorImpl = () => {
			throw new SyntaxError("bad selector");
		};
		const h = await mount("#(*&bad");
		expect(h.value).toBe(true);
		expect(observedCount).toBe(0);
		h.unmount();
	});
});
