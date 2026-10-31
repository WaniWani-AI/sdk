import { describe, expect, test } from "bun:test";
import {
	type RetrievalCollector,
	recordKbSearch,
	retrievalCollectorStore,
} from "./retrieval-context.js";

function makeTrace(query = "q") {
	return {
		query,
		resultCount: 1,
		results: [{ source: "a.md", heading: "A", score: 0.9 }],
	};
}

function collector() {
	return { searches: [] as ReturnType<typeof makeTrace>[] };
}

describe("retrieval collector — basics", () => {
	test("records into the active collector", () => {
		const c = collector();
		retrievalCollectorStore.run(c, () => recordKbSearch(makeTrace()));
		expect(c.searches).toHaveLength(1);
	});

	test("accumulates searches in call order", () => {
		const c = collector();
		retrievalCollectorStore.run(c, () => {
			recordKbSearch(makeTrace("a"));
			recordKbSearch(makeTrace("b"));
			recordKbSearch(makeTrace("c"));
		});
		expect(c.searches.map((s) => s.query)).toEqual(["a", "b", "c"]);
	});

	test("is a no-op with no active collector", () => {
		expect(() => recordKbSearch(makeTrace())).not.toThrow();
	});

	test("getStore is undefined outside any run()", () => {
		expect(retrievalCollectorStore.getStore()).toBeUndefined();
	});
});

describe("retrieval collector — context isolation", () => {
	// The serverless safety property: one isolate serves many concurrent
	// requests, but AsyncLocalStorage scopes each collector to its own async
	// context, so interleaved searches never cross-contaminate.
	test("concurrent contexts stay isolated", async () => {
		const a = collector();
		const b = collector();
		await Promise.all([
			retrievalCollectorStore.run(a, async () => {
				await Promise.resolve();
				recordKbSearch(makeTrace("a"));
			}),
			retrievalCollectorStore.run(b, async () => {
				await Promise.resolve();
				recordKbSearch(makeTrace("b"));
			}),
		]);
		expect(a.searches.map((s) => s.query)).toEqual(["a"]);
		expect(b.searches.map((s) => s.query)).toEqual(["b"]);
	});

	test("nested contexts: inner shadows outer, outer resumes after", () => {
		const outer = collector();
		const inner = collector();
		retrievalCollectorStore.run(outer, () => {
			recordKbSearch(makeTrace("outer1"));
			retrievalCollectorStore.run(inner, () =>
				recordKbSearch(makeTrace("inner")),
			);
			recordKbSearch(makeTrace("outer2"));
		});
		expect(outer.searches.map((s) => s.query)).toEqual(["outer1", "outer2"]);
		expect(inner.searches.map((s) => s.query)).toEqual(["inner"]);
	});

	test("the context does not leak after run() returns", () => {
		retrievalCollectorStore.run(collector(), () => {});
		expect(retrievalCollectorStore.getStore()).toBeUndefined();
		expect(() => recordKbSearch(makeTrace())).not.toThrow();
	});
});

describe("retrieval collector — context propagation", () => {
	test("survives multiple awaits inside run()", async () => {
		const c = collector();
		await retrievalCollectorStore.run(c, async () => {
			await Promise.resolve();
			await new Promise((r) => setTimeout(r, 0));
			recordKbSearch(makeTrace("late"));
		});
		expect(c.searches.map((s) => s.query)).toEqual(["late"]);
	});

	test("survives a setTimeout scheduled inside run()", async () => {
		const c = collector();
		await retrievalCollectorStore.run(
			c,
			() =>
				new Promise<void>((resolve) => {
					setTimeout(() => {
						recordKbSearch(makeTrace("timer"));
						resolve();
					}, 0);
				}),
		);
		expect(c.searches.map((s) => s.query)).toEqual(["timer"]);
	});

	test("parallel awaited work records into the same context", async () => {
		const c = collector();
		await retrievalCollectorStore.run(c, async () => {
			await Promise.all([
				(async () => {
					await Promise.resolve();
					recordKbSearch(makeTrace("p1"));
				})(),
				(async () => {
					await new Promise((r) => setTimeout(r, 0));
					recordKbSearch(makeTrace("p2"));
				})(),
			]);
		});
		expect(c.searches.map((s) => s.query).sort()).toEqual(["p1", "p2"]);
	});
});

describe("retrieval collector — robustness", () => {
	// recordKbSearch runs inside kb.search(); a throw would break a user's
	// search. A corrupted collector (e.g. a mixed SDK version) must not escape.
	test("never throws on a corrupted collector shape", () => {
		const corrupted = { searches: undefined } as unknown as RetrievalCollector;
		retrievalCollectorStore.run(corrupted, () => {
			expect(() => recordKbSearch(makeTrace())).not.toThrow();
		});
	});

	test("records only metadata, never chunk bodies", () => {
		const c = collector();
		retrievalCollectorStore.run(c, () => recordKbSearch(makeTrace()));
		expect(Object.keys(c.searches[0].results[0]).sort()).toEqual([
			"heading",
			"score",
			"source",
		]);
	});

	// This is what makes the two separate tsup bundles (core + mcp) share one
	// store: the export IS the globalThis slot.
	test("the exported store is the single shared global instance", () => {
		const slot = (globalThis as { __waniwaniKbRetrievalStore?: unknown })
			.__waniwaniKbRetrievalStore;
		expect(retrievalCollectorStore).toBe(slot);
	});
});
