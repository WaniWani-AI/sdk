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
const { STORAGE_MAX_AGE_MS } = await import("@waniwani/core/shared/visitor-id");

/** The id the key holds, or null. */
function storedId(): string | null {
	const raw = localStorage.getItem(KEY);
	return raw === null ? null : (JSON.parse(raw) as { id: string }).id;
}

function storedCreatedAt(): number | undefined {
	const raw = localStorage.getItem(KEY);
	return raw === null
		? undefined
		: (JSON.parse(raw) as { createdAt: number }).createdAt;
}

describe("getOrCreateVisitorId", () => {
	beforeEach(() => {
		localStorage.clear();
	});

	test("mints and persists an id on first call", () => {
		expect(localStorage.getItem(KEY)).toBeNull();
		const id = getOrCreateVisitorId();
		expect(typeof id).toBe("string");
		expect(id.length).toBeGreaterThan(0);
		expect(storedId()).toBe(id);
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

	test("keeps a legacy plain-string id and starts its 13 months now", () => {
		localStorage.setItem(KEY, "legacy-id");
		const before = Date.now();
		expect(getOrCreateVisitorId()).toBe("legacy-id");
		expect(storedId()).toBe("legacy-id");
		expect(storedCreatedAt()).toBeGreaterThanOrEqual(before);
	});

	test("keeps an id younger than 13 months and does not renew it", () => {
		const createdAt = Date.now() - STORAGE_MAX_AGE_MS + 60_000;
		localStorage.setItem(KEY, JSON.stringify({ id: "young", createdAt }));
		expect(getOrCreateVisitorId()).toBe("young");
		expect(storedCreatedAt()).toBe(createdAt);
	});

	test("replaces an id 13 months old with a new one", () => {
		const createdAt = Date.now() - STORAGE_MAX_AGE_MS;
		localStorage.setItem(KEY, JSON.stringify({ id: "expired", createdAt }));
		const id = getOrCreateVisitorId();
		expect(id).not.toBe("expired");
		expect(storedId()).toBe(id);
		expect(storedCreatedAt()).toBeGreaterThan(createdAt);
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
		expect(storedId()).toBe("posthog-distinct-123");
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

	test("starts a new 13 months when the host sets an id", () => {
		localStorage.setItem(
			KEY,
			JSON.stringify({ id: "old", createdAt: Date.now() - 1_000_000 }),
		);
		const before = Date.now();
		setVisitorId("host-id");
		expect(storedCreatedAt()).toBeGreaterThanOrEqual(before);
	});

	test("trims surrounding whitespace", () => {
		expect(setVisitorId("  padded-id  ")).toBe("padded-id");
		expect(storedId()).toBe("padded-id");
	});

	test("ignores a blank id and keeps the current one", () => {
		localStorage.setItem(KEY, "existing-id");
		expect(setVisitorId("   ")).toBe("existing-id");
		expect(storedId()).toBe("existing-id");
	});

	test("mints and keeps an auto id when a blank id is set with none stored", () => {
		expect(localStorage.getItem(KEY)).toBeNull();
		const returned = setVisitorId("");
		expect(returned.length).toBeGreaterThan(0);
		expect(storedId()).toBe(returned);
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
