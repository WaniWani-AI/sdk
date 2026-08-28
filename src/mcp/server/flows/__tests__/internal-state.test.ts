import { describe, expect, test } from "bun:test";
import { z } from "zod";
import type {
	FlowConfig,
	FlowInternalState,
	FlowTokenContent,
} from "../@types";
import type { FlowStore } from "../flow-store";
import {
	initInternalState,
	loadInternalState,
	takeInternalField,
	withInternalState,
} from "../internal-state";

class CountingStore implements FlowStore {
	reads = 0;
	constructor(private readonly record: FlowTokenContent | null = null) {}
	async get(): Promise<FlowTokenContent | null> {
		this.reads++;
		return this.record;
	}
	async set(): Promise<void> {}
	async delete(): Promise<void> {}
}

class ThrowingStore implements FlowStore {
	reads = 0;
	async get(): Promise<FlowTokenContent | null> {
		this.reads++;
		throw new Error("KV unreachable");
	}
	async set(): Promise<void> {}
	async delete(): Promise<void> {}
}

const INTRO = { verbatim: "Acme is the data controller." };
const SEEDED: FlowInternalState = { intro: INTRO };
const PREEXISTING = { sessionId: "s1", sessionIsPreexisting: true };

function flowConfig(intro?: FlowConfig["intro"]): FlowConfig {
	return {
		id: "home_quote",
		title: "Home insurance quote",
		description: "Quote a home insurance policy.",
		...(intro !== undefined ? { intro } : {}),
		state: { city: z.string().describe("City") },
	};
}

describe("initInternalState", () => {
	test("seeds the intro a flow declares", () => {
		expect(initInternalState(flowConfig(INTRO.verbatim))).toEqual(SEEDED);
	});

	test("a flow using none of the features seeds nothing", () => {
		expect(initInternalState(flowConfig())).toEqual({});
	});

	test("a malformed intro throws here, at compile time", () => {
		expect(() => initInternalState(flowConfig("  "))).toThrow(/empty string/);
	});
});

describe("loadInternalState", () => {
	test("a session already underway runs with what is left of its seed", async () => {
		const store = new CountingStore({
			step: "ask_city",
			state: {},
			internal: {},
		});

		expect(
			await loadInternalState({ store, ...PREEXISTING, seed: SEEDED }),
		).toEqual({});
		expect(store.reads).toBe(1);
	});

	test("a session id with no record behind it gets the seed", async () => {
		const store = new CountingStore(null);

		expect(
			await loadInternalState({ store, ...PREEXISTING, seed: SEEDED }),
		).toEqual(SEEDED);
	});

	test("skips the read when the seed is empty", async () => {
		const store = new CountingStore();

		expect(
			await loadInternalState({ store, ...PREEXISTING, seed: {} }),
		).toEqual({});
		expect(store.reads).toBe(0);
	});

	test("skips the read for a session id minted by this call", async () => {
		const store = new CountingStore();

		expect(
			await loadInternalState({
				store,
				...PREEXISTING,
				sessionIsPreexisting: false,
				seed: SEEDED,
			}),
		).toEqual(SEEDED);
		expect(store.reads).toBe(0);
	});

	test("a failed read falls back to the seed instead of throwing", async () => {
		const store = new ThrowingStore();

		expect(
			await loadInternalState({ store, ...PREEXISTING, seed: SEEDED }),
		).toEqual(SEEDED);
		expect(store.reads).toBe(1);
	});
});

describe("takeInternalField", () => {
	test("hands back the pending value and drops it", () => {
		const { value, internal } = takeInternalField(SEEDED, "intro");

		expect(value).toEqual(INTRO);
		expect(internal).toEqual({});
	});

	test("a field already taken reads as undefined", () => {
		const { value, internal } = takeInternalField({}, "intro");

		expect(value).toBeUndefined();
		expect(internal).toEqual({});
	});

	test("no internal state at all reads as undefined", () => {
		expect(takeInternalField(undefined, "intro").value).toBeUndefined();
	});

	test("keeps fields this version does not recognize", () => {
		const loaded = {
			intro: INTRO,
			consent: { accepted: true },
		} as FlowInternalState;

		const { value, internal } = takeInternalField(loaded, "intro");

		expect(value).toEqual(INTRO);
		expect(internal).toEqual({
			consent: { accepted: true },
		} as FlowInternalState);
	});
});

describe("withInternalState", () => {
	const token: FlowTokenContent = { step: "ask_city", state: { city: "Lyon" } };

	test("leaves the record alone when nothing is pending", () => {
		expect(withInternalState(token, {})).toEqual(token);
	});

	test("attaches what is still pending", () => {
		expect(withInternalState(token, SEEDED)).toEqual({
			...token,
			internal: SEEDED,
		});
	});
});
