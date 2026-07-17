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
});

function makeTrace() {
	return {
		query: "q",
		resultCount: 1,
		results: [{ source: "a.md", heading: "A", score: 0.9 }],
	};
}
