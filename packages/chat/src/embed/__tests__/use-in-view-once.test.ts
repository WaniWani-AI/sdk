import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";

// ---------------------------------------------------------------------------
// DOM setup before importing React (mirrors use-scroll-appearance.test.ts)
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
// Controllable IntersectionObserver
// ---------------------------------------------------------------------------

type IOEntry = { isIntersecting: boolean };
let ioCallback: ((entries: IOEntry[]) => void) | null = null;
let observedCount = 0;
let disconnectCount = 0;

class MockIntersectionObserver {
	constructor(cb: (entries: IOEntry[]) => void) {
		ioCallback = cb;
	}
	observe() {
		observedCount += 1;
	}
	disconnect() {
		disconnectCount += 1;
	}
	unobserve() {}
	takeRecords() {
		return [];
	}
}
// Restore the original afterwards: bun runs the suite in one shared process.
// biome-ignore lint/suspicious/noExplicitAny: test setup
const originalIO = (globalThis as any).IntersectionObserver;
// biome-ignore lint/suspicious/noExplicitAny: test setup
(globalThis as any).IntersectionObserver = MockIntersectionObserver;

afterAll(() => {
	// biome-ignore lint/suspicious/noExplicitAny: test teardown
	(globalThis as any).IntersectionObserver = originalIO;
});

const { act, createElement, useRef } = await import("react");
const { createRoot } = await import("react-dom/client");
const { useInViewOnce } = await import("../use-in-view-once");

// Render harness: a probe that puts the ref on a real div and surfaces the
// hook's value. `rerender` changes `enabled` on the same mount.
async function mount(enabled: boolean) {
	const container = win.document.createElement("div");
	let latest = false;
	function Probe({ on }: { on: boolean }) {
		const ref = useRef<HTMLDivElement>(null);
		latest = useInViewOnce(ref, on);
		return createElement("div", { ref });
	}
	// biome-ignore lint/suspicious/noExplicitAny: happy-dom Element vs DOM Element
	const root = createRoot(container as any);
	await act(async () => {
		root.render(createElement(Probe, { on: enabled }));
	});
	return {
		get value() {
			return latest;
		},
		async rerender(on: boolean) {
			await act(async () => {
				root.render(createElement(Probe, { on }));
			});
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
	disconnectCount = 0;
});

describe("useInViewOnce", () => {
	test("observes nothing while disabled", async () => {
		const h = await mount(false);
		expect(h.value).toBe(false);
		expect(observedCount).toBe(0);
		h.unmount();
	});

	test("stays false until the element intersects", async () => {
		const h = await mount(true);
		expect(observedCount).toBe(1);
		await h.fire({ isIntersecting: false });
		expect(h.value).toBe(false);
		await h.fire({ isIntersecting: true });
		expect(h.value).toBe(true);
		h.unmount();
	});

	test("starts observing when it turns enabled", async () => {
		const h = await mount(false);
		await h.rerender(true);
		expect(observedCount).toBe(1);
		await h.fire({ isIntersecting: true });
		expect(h.value).toBe(true);
		h.unmount();
	});

	test("latches: stays true and stops observing after the first hit", async () => {
		const h = await mount(true);
		await h.fire({ isIntersecting: true });
		expect(disconnectCount).toBeGreaterThan(0);
		await h.fire({ isIntersecting: false });
		expect(h.value).toBe(true);
		await h.rerender(false);
		expect(h.value).toBe(true);
		h.unmount();
	});

	test("reports true at once without IntersectionObserver", async () => {
		// biome-ignore lint/suspicious/noExplicitAny: test setup
		(globalThis as any).IntersectionObserver = undefined;
		try {
			const h = await mount(true);
			expect(h.value).toBe(true);
			expect(observedCount).toBe(0);
			h.unmount();
		} finally {
			// biome-ignore lint/suspicious/noExplicitAny: test setup
			(globalThis as any).IntersectionObserver = MockIntersectionObserver;
		}
	});
});
