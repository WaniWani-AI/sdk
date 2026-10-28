import { afterEach, describe, expect, test } from "bun:test";
import {
	type Consent,
	getConsent,
	hasStorageConsent,
	isConsent,
	onConsentChange,
	setConsent,
} from "../consent";

const unsubscribers: Array<() => void> = [];

function listen(fn: (consent: Consent) => void): () => void {
	const off = onConsentChange(fn);
	unsubscribers.push(off);
	return off;
}

function asConsent(value: unknown): Consent {
	// A CMP callback can hand over anything at runtime; the type only exists at compile time.
	// biome-ignore lint/suspicious/noExplicitAny: deliberately passes an invalid runtime value
	return value as any;
}

afterEach(() => {
	for (const off of unsubscribers.splice(0)) {
		off();
	}
	setConsent("granted");
});

describe("consent defaults", () => {
	test("a freshly loaded module starts granted", async () => {
		const fresh = (await import(
			`../consent?t=${Date.now()}-${Math.random()}`
		)) as typeof import("../consent");
		expect(fresh.getConsent()).toBe("granted");
		expect(fresh.hasStorageConsent()).toBe(true);
	});
});

describe("isConsent", () => {
	test("accepts exactly the three states", () => {
		expect(isConsent("granted")).toBe(true);
		expect(isConsent("pending")).toBe(true);
		expect(isConsent("denied")).toBe(true);
	});

	test("rejects near misses and non-strings", () => {
		for (const value of [
			"GRANTED",
			"Denied",
			" pending",
			"granted ",
			"",
			"yes",
			"true",
			null,
			undefined,
			0,
			1,
			true,
			{},
			["granted"],
		]) {
			expect(isConsent(value)).toBe(false);
		}
	});
});

describe("setConsent / getConsent / hasStorageConsent", () => {
	test("each state is applied and returned", () => {
		expect(setConsent("pending")).toBe("pending");
		expect(getConsent()).toBe("pending");
		expect(hasStorageConsent()).toBe(false);

		expect(setConsent("denied")).toBe("denied");
		expect(getConsent()).toBe("denied");
		expect(hasStorageConsent()).toBe(false);

		expect(setConsent("granted")).toBe("granted");
		expect(getConsent()).toBe("granted");
		expect(hasStorageConsent()).toBe(true);
	});

	test("an unknown value is ignored and the current state is returned", () => {
		setConsent("denied");
		const notified: Consent[] = [];
		listen((c) => notified.push(c));

		for (const bad of [
			"granted ",
			"GRANTED",
			"",
			"allow",
			null,
			undefined,
			1,
		]) {
			expect(setConsent(asConsent(bad))).toBe("denied");
			expect(getConsent()).toBe("denied");
		}
		expect(hasStorageConsent()).toBe(false);
		expect(notified).toEqual([]);
	});

	test("an unknown value while pending does not widen to granted", () => {
		setConsent("pending");
		expect(setConsent(asConsent("Granted"))).toBe("pending");
		expect(hasStorageConsent()).toBe(false);
	});
});

describe("onConsentChange", () => {
	test("listeners receive each change in order", () => {
		const notified: Consent[] = [];
		listen((c) => notified.push(c));
		setConsent("pending");
		setConsent("denied");
		setConsent("granted");
		setConsent("pending");
		expect(notified).toEqual(["pending", "denied", "granted", "pending"]);
	});

	test("setting the same state twice notifies only the first time", () => {
		const notified: Consent[] = [];
		listen((c) => notified.push(c));
		setConsent("pending");
		setConsent("pending");
		setConsent("pending");
		expect(notified).toEqual(["pending"]);
	});

	test("setting granted while already granted notifies nobody", () => {
		let calls = 0;
		listen(() => {
			calls++;
		});
		expect(getConsent()).toBe("granted");
		expect(setConsent("granted")).toBe("granted");
		expect(calls).toBe(0);
	});

	test("the new state is visible to listeners while they run", () => {
		const seen: Array<[Consent, Consent, boolean]> = [];
		listen((c) => seen.push([c, getConsent(), hasStorageConsent()]));
		setConsent("denied");
		setConsent("granted");
		expect(seen).toEqual([
			["denied", "denied", false],
			["granted", "granted", true],
		]);
	});

	test("a throwing listener does not stop the others, and setConsent does not throw", () => {
		const before: Consent[] = [];
		const after: Consent[] = [];
		listen((c) => before.push(c));
		listen(() => {
			throw new Error("listener boom");
		});
		listen((c) => after.push(c));

		expect(() => setConsent("pending")).not.toThrow();
		expect(getConsent()).toBe("pending");
		expect(before).toEqual(["pending"]);
		expect(after).toEqual(["pending"]);

		// The throwing listener stays registered and keeps not breaking later changes.
		expect(() => setConsent("denied")).not.toThrow();
		expect(after).toEqual(["pending", "denied"]);
	});

	test("unsubscribe stops notifications and is safe to call twice", () => {
		const notified: Consent[] = [];
		const off = listen((c) => notified.push(c));
		setConsent("pending");
		off();
		off();
		setConsent("denied");
		expect(notified).toEqual(["pending"]);
	});

	test("unsubscribing one listener keeps the others", () => {
		const a: Consent[] = [];
		const b: Consent[] = [];
		const offA = listen((c) => a.push(c));
		listen((c) => b.push(c));
		offA();
		setConsent("denied");
		expect(a).toEqual([]);
		expect(b).toEqual(["denied"]);
	});

	test("a listener that unsubscribes itself mid-dispatch does not skip the next one", () => {
		const later: Consent[] = [];
		const off = listen(() => off());
		listen((c) => later.push(c));
		setConsent("pending");
		setConsent("denied");
		expect(later).toEqual(["pending", "denied"]);
	});

	test("an ignored unknown value notifies nobody", () => {
		let calls = 0;
		listen(() => {
			calls++;
		});
		setConsent(asConsent("nope"));
		expect(calls).toBe(0);
	});
});
