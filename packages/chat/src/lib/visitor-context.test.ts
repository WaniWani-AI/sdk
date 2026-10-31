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

const { applyVisitorId, getOrCreateVisitorId, setVisitorId } = await import(
	"./visitor-context"
);

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

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

describe("setVisitorId", () => {
	beforeEach(() => {
		localStorage.clear();
	});

	test("persists a host-supplied id and returns it", () => {
		const returned = setVisitorId("posthog-distinct-123");
		expect(returned).toBe("posthog-distinct-123");
		expect(localStorage.getItem(KEY)).toBe("posthog-distinct-123");
	});

	test("becomes the id every later read returns", () => {
		setVisitorId("amplitude-abc");
		expect(getOrCreateVisitorId()).toBe("amplitude-abc");
	});

	test("overrides an already-generated auto id", () => {
		const auto = getOrCreateVisitorId();
		expect(setVisitorId("external-xyz")).toBe("external-xyz");
		expect(getOrCreateVisitorId()).toBe("external-xyz");
		expect(getOrCreateVisitorId()).not.toBe(auto);
	});

	test("trims surrounding whitespace", () => {
		expect(setVisitorId("  padded-id  ")).toBe("padded-id");
		expect(localStorage.getItem(KEY)).toBe("padded-id");
	});

	test("ignores a blank id and keeps the current one", () => {
		localStorage.setItem(KEY, "existing-id");
		expect(setVisitorId("   ")).toBe("existing-id");
		expect(localStorage.getItem(KEY)).toBe("existing-id");
	});

	test("mints and keeps an auto id when a blank id is set with none stored", () => {
		expect(localStorage.getItem(KEY)).toBeNull();
		const returned = setVisitorId("");
		expect(returned.length).toBeGreaterThan(0);
		expect(localStorage.getItem(KEY)).toBe(returned);
	});
});

describe("applyVisitorId", () => {
	beforeEach(() => {
		localStorage.clear();
	});

	test("applies a literal string synchronously", () => {
		applyVisitorId("literal-id");
		expect(getOrCreateVisitorId()).toBe("literal-id");
	});

	test("applies a sync resolver's return value", () => {
		applyVisitorId(() => "resolver-id");
		expect(getOrCreateVisitorId()).toBe("resolver-id");
	});

	test("applies an async resolver once it settles", async () => {
		applyVisitorId(async () => "async-id");
		await tick();
		expect(getOrCreateVisitorId()).toBe("async-id");
	});

	test("ignores undefined input, keeping the current id", () => {
		localStorage.setItem(KEY, "existing");
		applyVisitorId(undefined);
		expect(getOrCreateVisitorId()).toBe("existing");
	});

	test("ignores a resolver that returns null/blank", () => {
		localStorage.setItem(KEY, "existing");
		applyVisitorId(() => null);
		expect(getOrCreateVisitorId()).toBe("existing");
	});

	test("ignores a throwing resolver", () => {
		localStorage.setItem(KEY, "existing");
		applyVisitorId(() => {
			throw new Error("not ready");
		});
		expect(getOrCreateVisitorId()).toBe("existing");
	});

	test("ignores a rejected async resolver", async () => {
		localStorage.setItem(KEY, "existing");
		applyVisitorId(() => Promise.reject(new Error("boom")));
		await tick();
		expect(getOrCreateVisitorId()).toBe("existing");
	});

	test("cancel drops a late async result", async () => {
		localStorage.setItem(KEY, "existing");
		const cancel = applyVisitorId(async () => "late-id");
		cancel();
		await tick();
		expect(getOrCreateVisitorId()).toBe("existing");
	});
});
