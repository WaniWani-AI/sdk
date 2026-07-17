import { afterEach, describe, expect, test } from "bun:test";
import type { InternalConfig } from "../types.js";
import { createKbClient } from "./client.js";
import { retrievalCollectorStore } from "./retrieval-context.js";
import type { KbSearchTrace } from "./types.js";

const config: InternalConfig = {
	apiUrl: "https://example.test",
	apiKey: "wwk_test",
	tracking: {
		endpointPath: "/api/mcp/events/v2/batch",
		flushIntervalMs: 1000,
		maxBatchSize: 20,
		maxBufferSize: 1000,
		maxRetries: 3,
		retryBaseDelayMs: 200,
		retryMaxDelayMs: 2000,
		shutdownTimeoutMs: 2000,
	},
};

const originalFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = originalFetch;
});

function stubFetch(data: unknown) {
	globalThis.fetch = Object.assign(
		async () => new Response(JSON.stringify({ data }), { status: 200 }),
		{ preconnect: () => {} },
	);
}

describe("kb.search retrieval trace", () => {
	test("records a metadata-only trace into the active collector", async () => {
		stubFetch([{ source: "a.md", heading: "A", content: "body", score: 0.9 }]);
		const kb = createKbClient(config);
		const collector: { searches: KbSearchTrace[] } = { searches: [] };
		await retrievalCollectorStore.run(collector, () => kb.search("hello"));
		expect(collector.searches).toEqual([
			{
				query: "hello",
				resultCount: 1,
				results: [{ source: "a.md", heading: "A", score: 0.9 }],
			},
		]);
	});

	test("records resultCount 0 for an empty search", async () => {
		stubFetch([]);
		const kb = createKbClient(config);
		const collector: { searches: KbSearchTrace[] } = { searches: [] };
		await retrievalCollectorStore.run(collector, () => kb.search("miss"));
		expect(collector.searches).toEqual([
			{ query: "miss", resultCount: 0, results: [] },
		]);
	});
});
