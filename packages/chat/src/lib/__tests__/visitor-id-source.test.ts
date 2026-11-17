import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";

const win = new Window({ url: "https://localhost" });
for (const key of ["localStorage", "navigator"] as const) {
	// biome-ignore lint/suspicious/noExplicitAny: test setup
	(globalThis as any)[key] = (win as any)[key];
}

const {
	applyVisitorId,
	getOrCreateVisitorId,
	getVisitorIdSource,
	setVisitorId,
} = await import("../visitor-context");

const ID_KEY = "waniwani-visitor-id";
const SOURCE_KEY = "waniwani-visitor-id-source";
const AMPLITUDE_DEVICE_ID = "3b241101-e2bb-4255-8caf-4136c566a962";

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
	localStorage.clear();
});

describe("getVisitorIdSource", () => {
	test("an id the chat mints reads as generated", () => {
		getOrCreateVisitorId();
		expect(getVisitorIdSource()).toBe("generated");
	});

	test("an id the page sets with setVisitorId reads as customer", () => {
		setVisitorId(AMPLITUDE_DEVICE_ID);
		expect(getOrCreateVisitorId()).toBe(AMPLITUDE_DEVICE_ID);
		expect(getVisitorIdSource()).toBe("customer");
	});

	test("a page-set id that replaces a minted one turns the source to customer", () => {
		getOrCreateVisitorId();
		setVisitorId(AMPLITUDE_DEVICE_ID);
		expect(getVisitorIdSource()).toBe("customer");
	});

	test("an id stored before the source existed reads as generated", () => {
		localStorage.setItem(ID_KEY, AMPLITUDE_DEVICE_ID);
		expect(getOrCreateVisitorId()).toBe(AMPLITUDE_DEVICE_ID);
		expect(getVisitorIdSource()).toBe("generated");
	});

	test("a source value nobody defined reads as generated", () => {
		localStorage.setItem(ID_KEY, AMPLITUDE_DEVICE_ID);
		localStorage.setItem(SOURCE_KEY, "Customer");
		expect(getVisitorIdSource()).toBe("generated");
	});

	test("a blank id from the page keeps a page-set id and its customer source", () => {
		setVisitorId(AMPLITUDE_DEVICE_ID);
		expect(setVisitorId("   ")).toBe(AMPLITUDE_DEVICE_ID);
		expect(getVisitorIdSource()).toBe("customer");
	});

	test("a blank id from the page with nothing stored mints an id that reads as generated", () => {
		const minted = setVisitorId("");
		expect(minted.length).toBeGreaterThan(0);
		expect(getVisitorIdSource()).toBe("generated");
	});

	test("a page-set id that was wiped from storage is replaced by a minted one that reads as generated", () => {
		setVisitorId(AMPLITUDE_DEVICE_ID);
		localStorage.removeItem(ID_KEY);

		const minted = getOrCreateVisitorId();

		expect(minted).not.toBe(AMPLITUDE_DEVICE_ID);
		expect(getVisitorIdSource()).toBe("generated");
	});

	test("reading a stored id never changes its source", () => {
		setVisitorId(AMPLITUDE_DEVICE_ID);
		getOrCreateVisitorId();
		getOrCreateVisitorId();
		expect(getVisitorIdSource()).toBe("customer");
	});
});

describe("getVisitorIdSource through applyVisitorId", () => {
	test("a literal id reads as customer", () => {
		applyVisitorId(AMPLITUDE_DEVICE_ID);
		expect(getVisitorIdSource()).toBe("customer");
	});

	test("an async resolver reads as generated until it settles, then customer", async () => {
		getOrCreateVisitorId();
		applyVisitorId(async () => AMPLITUDE_DEVICE_ID);
		expect(getVisitorIdSource()).toBe("generated");

		await tick();

		expect(getOrCreateVisitorId()).toBe(AMPLITUDE_DEVICE_ID);
		expect(getVisitorIdSource()).toBe("customer");
	});

	test("a resolver that returns null keeps a minted id reading as generated", () => {
		getOrCreateVisitorId();
		applyVisitorId(() => null);
		expect(getVisitorIdSource()).toBe("generated");
	});

	test("a throwing resolver keeps a minted id reading as generated", () => {
		getOrCreateVisitorId();
		applyVisitorId(() => {
			throw new Error("not ready");
		});
		expect(getVisitorIdSource()).toBe("generated");
	});

	test("a cancelled async resolver leaves the source as generated", async () => {
		getOrCreateVisitorId();
		const cancel = applyVisitorId(async () => AMPLITUDE_DEVICE_ID);
		cancel();
		await tick();
		expect(getVisitorIdSource()).toBe("generated");
	});
});

describe("getVisitorIdSource without storage", () => {
	const storage = globalThis.localStorage;

	afterEach(() => {
		// biome-ignore lint/suspicious/noExplicitAny: restore storage
		(globalThis as any).localStorage = storage;
	});

	test("a browser that blocks storage reads as generated", () => {
		// biome-ignore lint/suspicious/noExplicitAny: simulate blocked storage
		(globalThis as any).localStorage = {
			getItem: () => {
				throw new Error("SecurityError");
			},
			setItem: () => {
				throw new Error("SecurityError");
			},
		};

		getOrCreateVisitorId();

		expect(getVisitorIdSource()).toBe("generated");
	});
});
