import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";

const win = new Window({ url: "https://localhost" });
for (const key of ["localStorage", "navigator"] as const) {
	// biome-ignore lint/suspicious/noExplicitAny: test setup
	(globalThis as any)[key] = (win as any)[key];
}

const { setConsent } = await import("../consent");
const { getOrCreateVisitorId, setVisitorId } = await import("../visitor-id");

const KEY = "waniwani-visitor-id";

type Op = { op: "get" | "set" | "remove"; key: string };

/** Records every access to the real storage, so a test can assert nothing touched the visitor key. */
function installSpyStorage(): Op[] {
	const real = win.localStorage;
	const ops: Op[] = [];
	const spy = {
		getItem(key: string) {
			ops.push({ op: "get", key });
			return real.getItem(key);
		},
		setItem(key: string, value: string) {
			ops.push({ op: "set", key });
			real.setItem(key, value);
		},
		removeItem(key: string) {
			ops.push({ op: "remove", key });
			real.removeItem(key);
		},
		clear() {
			real.clear();
		},
		key(index: number) {
			return real.key(index);
		},
		get length() {
			return real.length;
		},
	};
	// biome-ignore lint/suspicious/noExplicitAny: test setup
	(globalThis as any).localStorage = spy;
	return ops;
}

function visitorOps(ops: Op[]): Op[] {
	return ops.filter((o) => o.key === KEY);
}

beforeEach(() => {
	// biome-ignore lint/suspicious/noExplicitAny: test setup
	(globalThis as any).localStorage = win.localStorage;
	win.localStorage.clear();
});

afterEach(() => {
	setConsent("granted");
	// biome-ignore lint/suspicious/noExplicitAny: test setup
	(globalThis as any).localStorage = win.localStorage;
	win.localStorage.clear();
});

describe("visitor id while consent is pending", () => {
	test("never reads or writes the visitor key and keeps one id for the page", () => {
		setConsent("pending");
		const ops = installSpyStorage();
		const a = getOrCreateVisitorId();
		const b = getOrCreateVisitorId();
		const c = getOrCreateVisitorId();
		expect(typeof a).toBe("string");
		expect(a.length).toBeGreaterThan(0);
		expect(b).toBe(a);
		expect(c).toBe(a);
		expect(visitorOps(ops)).toEqual([]);
		expect(win.localStorage.getItem(KEY)).toBeNull();
	});

	test("does not return a pre-existing stored id and leaves it in place", () => {
		win.localStorage.setItem(KEY, "stored-from-last-week");
		setConsent("pending");
		const ops = installSpyStorage();
		const id = getOrCreateVisitorId();
		expect(id).not.toBe("stored-from-last-week");
		expect(visitorOps(ops)).toEqual([]);
		// Pending is not a refusal, so the earlier grant's id stays on the device.
		expect(win.localStorage.getItem(KEY)).toBe("stored-from-last-week");
	});

	test("setVisitorId keeps the host id in memory only", () => {
		setConsent("pending");
		const ops = installSpyStorage();
		expect(setVisitorId("posthog-123")).toBe("posthog-123");
		expect(getOrCreateVisitorId()).toBe("posthog-123");
		expect(getOrCreateVisitorId()).toBe("posthog-123");
		expect(visitorOps(ops)).toEqual([]);
		expect(win.localStorage.getItem(KEY)).toBeNull();
	});

	test("setVisitorId trims, and a blank id keeps the current page id", () => {
		setConsent("pending");
		const auto = getOrCreateVisitorId();
		expect(setVisitorId("   ")).toBe(auto);
		expect(setVisitorId("")).toBe(auto);
		expect(getOrCreateVisitorId()).toBe(auto);
		expect(setVisitorId("  host-id  ")).toBe("host-id");
		expect(getOrCreateVisitorId()).toBe("host-id");
	});

	test("the pending id differs from one minted on a previous pending page", () => {
		setConsent("pending");
		const first = getOrCreateVisitorId();
		// A denial resets the page; going back to pending mints a fresh id.
		setConsent("denied");
		setConsent("pending");
		expect(getOrCreateVisitorId()).not.toBe(first);
	});
});

describe("visitor id after consent is granted", () => {
	test("an auto id minted while pending is persisted when nothing is stored", () => {
		setConsent("pending");
		const pendingId = getOrCreateVisitorId();
		expect(win.localStorage.getItem(KEY)).toBeNull();
		setConsent("granted");
		const grantedId = getOrCreateVisitorId();
		expect(grantedId).toBe(pendingId);
		expect(win.localStorage.getItem(KEY)).toBe(pendingId);
		expect(getOrCreateVisitorId()).toBe(pendingId);
	});

	test("an existing stored id wins over the auto pending id", () => {
		win.localStorage.setItem(KEY, "returning-visitor");
		setConsent("pending");
		const pendingId = getOrCreateVisitorId();
		expect(pendingId).not.toBe("returning-visitor");
		setConsent("granted");
		expect(getOrCreateVisitorId()).toBe("returning-visitor");
		expect(win.localStorage.getItem(KEY)).toBe("returning-visitor");
	});

	test("a host id set while pending overwrites a stored id", () => {
		win.localStorage.setItem(KEY, "returning-visitor");
		setConsent("pending");
		setVisitorId("posthog-xyz");
		setConsent("granted");
		expect(getOrCreateVisitorId()).toBe("posthog-xyz");
		expect(win.localStorage.getItem(KEY)).toBe("posthog-xyz");
	});

	test("a host id set while pending is persisted when nothing is stored", () => {
		setConsent("pending");
		setVisitorId("posthog-xyz");
		setConsent("granted");
		expect(getOrCreateVisitorId()).toBe("posthog-xyz");
		expect(win.localStorage.getItem(KEY)).toBe("posthog-xyz");
	});

	test("the last host id set while pending is the one persisted", () => {
		setConsent("pending");
		setVisitorId("first");
		setVisitorId("second");
		setConsent("granted");
		expect(getOrCreateVisitorId()).toBe("second");
		expect(win.localStorage.getItem(KEY)).toBe("second");
	});

	test("a host id set after an auto pending id still wins over a stored id", () => {
		win.localStorage.setItem(KEY, "returning-visitor");
		setConsent("pending");
		getOrCreateVisitorId();
		setVisitorId("posthog-late");
		setConsent("granted");
		expect(getOrCreateVisitorId()).toBe("posthog-late");
	});

	test("setVisitorId under grant persists directly", () => {
		expect(setVisitorId("granted-host")).toBe("granted-host");
		expect(win.localStorage.getItem(KEY)).toBe("granted-host");
		expect(getOrCreateVisitorId()).toBe("granted-host");
	});

	test("a later host id under grant overwrites the one promoted from pending", () => {
		setConsent("pending");
		setVisitorId("pending-host");
		setConsent("granted");
		setVisitorId("granted-host");
		expect(getOrCreateVisitorId()).toBe("granted-host");
		expect(win.localStorage.getItem(KEY)).toBe("granted-host");
	});
});

describe("visitor id when consent is denied", () => {
	test("denial deletes the stored id and the next id is fresh and in memory", () => {
		const stored = getOrCreateVisitorId();
		expect(win.localStorage.getItem(KEY)).toBe(stored);
		setConsent("denied");
		expect(win.localStorage.getItem(KEY)).toBeNull();

		const ops = installSpyStorage();
		const next = getOrCreateVisitorId();
		expect(next).not.toBe(stored);
		expect(getOrCreateVisitorId()).toBe(next);
		expect(visitorOps(ops)).toEqual([]);
		expect(win.localStorage.getItem(KEY)).toBeNull();
	});

	test("denial from pending deletes an id a previous grant stored", () => {
		win.localStorage.setItem(KEY, "old-grant");
		setConsent("pending");
		setConsent("denied");
		expect(win.localStorage.getItem(KEY)).toBeNull();
	});

	test("a host id set while pending is dropped by a denial", () => {
		setConsent("pending");
		setVisitorId("posthog-xyz");
		setConsent("denied");
		expect(getOrCreateVisitorId()).not.toBe("posthog-xyz");
		setConsent("granted");
		const afterGrant = getOrCreateVisitorId();
		expect(afterGrant).not.toBe("posthog-xyz");
		expect(win.localStorage.getItem(KEY)).toBe(afterGrant);
	});

	test("setVisitorId under denial writes nothing", () => {
		setConsent("denied");
		const ops = installSpyStorage();
		expect(setVisitorId("host-denied")).toBe("host-denied");
		expect(getOrCreateVisitorId()).toBe("host-denied");
		expect(visitorOps(ops)).toEqual([]);
	});

	test("granting after a denial does not resurrect the deleted id", () => {
		const original = getOrCreateVisitorId();
		setConsent("denied");
		setConsent("granted");
		const next = getOrCreateVisitorId();
		expect(next).not.toBe(original);
		expect(win.localStorage.getItem(KEY)).toBe(next);
	});

	test("a throwing localStorage does not break the denial or the in-memory id", () => {
		const throwing = {
			getItem: () => {
				throw new Error("blocked");
			},
			setItem: () => {
				throw new Error("blocked");
			},
			removeItem: () => {
				throw new Error("blocked");
			},
			clear: () => {},
			key: () => null,
			length: 0,
		};
		// biome-ignore lint/suspicious/noExplicitAny: test setup
		(globalThis as any).localStorage = throwing;
		expect(() => setConsent("denied")).not.toThrow();
		const a = getOrCreateVisitorId();
		expect(getOrCreateVisitorId()).toBe(a);
	});
});
