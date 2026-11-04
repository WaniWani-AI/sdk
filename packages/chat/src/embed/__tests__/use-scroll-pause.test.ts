import { describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { watchScrollPause } from "../use-scroll-pause";

const PAUSE_MS = 1000;

function setup(initialY = 0) {
	const win = new Window({ url: "https://shop.example.com/" });
	const pending: Array<{ run: () => void; ms: number; cancelled: boolean }> =
		[];
	const calls: string[] = [];
	let section: string | null = "intro";

	const scrollTo = (y: number) => {
		Object.defineProperty(win, "scrollY", { value: y, configurable: true });
		win.dispatchEvent(new win.Event("scroll"));
	};
	Object.defineProperty(win, "scrollY", {
		value: initialY,
		configurable: true,
	});

	const stop = watchScrollPause(win as unknown as globalThis.Window, {
		pauseMs: PAUSE_MS,
		onPause: (key) => calls.push(key),
		sectionKeyAt: () => section,
		schedule: (run, ms) => {
			const entry = { run, ms, cancelled: false };
			pending.push(entry);
			return () => {
				entry.cancelled = true;
			};
		},
	});

	const settle = () => {
		const live = pending.splice(0).filter((entry) => !entry.cancelled);
		for (const entry of live) {
			expect(entry.ms).toBe(PAUSE_MS);
			entry.run();
		}
		return live.length;
	};

	return {
		calls,
		scrollTo,
		settle,
		stop,
		enter: (key: string | null) => {
			section = key;
		},
	};
}

describe("watchScrollPause", () => {
	test("fires once per section after the pause", () => {
		const t = setup();

		t.scrollTo(100);
		t.scrollTo(180);
		expect(t.settle()).toBe(1);
		expect(t.calls).toEqual(["intro"]);

		t.scrollTo(260);
		t.settle();
		expect(t.calls).toEqual(["intro"]);

		t.enter("pricing");
		t.scrollTo(900);
		t.settle();
		expect(t.calls).toEqual(["intro", "pricing"]);

		t.enter(null);
		t.scrollTo(1400);
		t.settle();
		expect(t.calls).toEqual(["intro", "pricing"]);

		t.stop();
		t.enter("faq");
		t.scrollTo(2000);
		expect(t.settle()).toBe(0);
		expect(t.calls).toEqual(["intro", "pricing"]);
	});

	test("does not fire on upward scroll", () => {
		const t = setup(800);

		t.scrollTo(500);
		t.settle();
		expect(t.calls).toEqual([]);

		t.scrollTo(700);
		t.scrollTo(650);
		expect(t.settle()).toBe(0);
		expect(t.calls).toEqual([]);
		t.stop();
	});
});
