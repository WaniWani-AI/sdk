import { beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";

// ---------------------------------------------------------------------------
// DOM globals (localStorage + crypto) before importing the module under test.
// ---------------------------------------------------------------------------
const win = new Window({ url: "https://localhost" });
for (const key of ["localStorage", "navigator"] as const) {
	// biome-ignore lint/suspicious/noExplicitAny: test setup
	(globalThis as any)[key] = (win as any)[key];
}

const { getOrCreateVisitorId } = await import("./visitor-context");

const KEY = "waniwani-visitor-id";

describe("getOrCreateVisitorId", () => {
	beforeEach(() => {
		localStorage.clear();
	});

	test("mints and persists an id on first call", () => {
		expect(localStorage.getItem(KEY)).toBeNull();
		const id = getOrCreateVisitorId();
		expect(typeof id).toBe("string");
		expect(id.length).toBeGreaterThan(0);
		expect(localStorage.getItem(KEY)).toBe(id);
	});

	test("returns the same persisted id on subsequent calls", () => {
		const first = getOrCreateVisitorId();
		const second = getOrCreateVisitorId();
		expect(second).toBe(first);
	});

	test("honours a pre-existing stored id", () => {
		localStorage.setItem(KEY, "preexisting-id");
		expect(getOrCreateVisitorId()).toBe("preexisting-id");
	});

	test("returns an id even when crypto is unavailable (non-secure context)", () => {
		const original = globalThis.crypto;
		// biome-ignore lint/suspicious/noExplicitAny: simulate a non-secure context
		(globalThis as any).crypto = undefined;
		try {
			const id = getOrCreateVisitorId();
			expect(typeof id).toBe("string");
			expect(id.length).toBeGreaterThan(0);
		} finally {
			// biome-ignore lint/suspicious/noExplicitAny: restore
			(globalThis as any).crypto = original;
		}
	});
});
