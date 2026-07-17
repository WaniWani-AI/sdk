import { describe, expect, test } from "bun:test";
import {
	recordKbSearch,
	retrievalCollectorStore,
} from "./retrieval-context.js";

describe("retrieval collector", () => {
	test("records into the active collector", () => {
		const collector = { searches: [] as ReturnType<typeof makeTrace>[] };
		retrievalCollectorStore.run(collector, () => {
			recordKbSearch(makeTrace());
		});
		expect(collector.searches).toHaveLength(1);
	});

	test("is a no-op with no active collector", () => {
		expect(() => recordKbSearch(makeTrace())).not.toThrow();
	});

	// The serverless safety property: one isolate serves many concurrent
	// requests, but AsyncLocalStorage scopes each collector to its own async
	// context, so interleaved searches never cross-contaminate.
	test("concurrent contexts stay isolated", async () => {
		const a = { searches: [] as ReturnType<typeof makeTrace>[] };
		const b = { searches: [] as ReturnType<typeof makeTrace>[] };
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
});

function makeTrace(query = "q") {
	return {
		query,
		resultCount: 1,
		results: [{ source: "a.md", heading: "A", score: 0.9 }],
	};
}
