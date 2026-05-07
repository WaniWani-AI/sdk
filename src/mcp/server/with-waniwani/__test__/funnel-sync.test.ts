import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { FlowGraph } from "../../flows/@types.js";
import { syncFlowGraphs } from "../funnel-sync.js";

const SYNC_CACHE_KEY = "__waniwani_funnel_sync_cache__";

const mockFetch = mock(async () => new Response(null, { status: 200 }));

const GRAPH_A: FlowGraph = {
	flowId: "flow-a",
	title: "Flow A",
	nodes: [
		{ id: "n1", type: "widget", label: "Step 1" },
		{ id: "n2", type: "action", label: "Step 2" },
	],
	edges: [{ from: "n1", to: "n2", type: "direct" }],
};

const GRAPH_B: FlowGraph = {
	flowId: "flow-b",
	title: "Flow B",
	nodes: [{ id: "x1", type: "interrupt", label: "Ask" }],
	edges: [],
};

beforeEach(() => {
	mockFetch.mockClear();
	globalThis.fetch = mockFetch as unknown as typeof fetch;
	// Clear the sync cache between tests
	delete (globalThis as Record<string, unknown>)[SYNC_CACHE_KEY];
});

afterEach(() => {
	delete (globalThis as Record<string, unknown>)[SYNC_CACHE_KEY];
});

describe("syncFlowGraphs", () => {
	test("skips sync when composite hash matches cached value", async () => {
		await syncFlowGraphs([GRAPH_A], "https://api.test", "key-1");
		// Allow the fire-and-forget fetch + .then() to settle
		await new Promise((r) => setTimeout(r, 10));

		expect(mockFetch).toHaveBeenCalledTimes(1);

		// Second call with identical graphs should be skipped
		await syncFlowGraphs([GRAPH_A], "https://api.test", "key-1");
		await new Promise((r) => setTimeout(r, 10));

		expect(mockFetch).toHaveBeenCalledTimes(1);
	});

	test("syncs again when graphs change", async () => {
		await syncFlowGraphs([GRAPH_A], "https://api.test", "key-1");
		await new Promise((r) => setTimeout(r, 10));

		expect(mockFetch).toHaveBeenCalledTimes(1);

		// Different graph should trigger a new sync
		await syncFlowGraphs([GRAPH_B], "https://api.test", "key-1");
		await new Promise((r) => setTimeout(r, 10));

		expect(mockFetch).toHaveBeenCalledTimes(2);
	});

	test("does not cache on fetch failure — retries on next call", async () => {
		mockFetch.mockImplementationOnce(async () => {
			throw new Error("network error");
		});

		await syncFlowGraphs([GRAPH_A], "https://api.test", "key-1");
		await new Promise((r) => setTimeout(r, 10));

		expect(mockFetch).toHaveBeenCalledTimes(1);

		// Same graphs, but previous call failed so should retry
		mockFetch.mockImplementationOnce(
			async () => new Response(null, { status: 200 }),
		);
		await syncFlowGraphs([GRAPH_A], "https://api.test", "key-1");
		await new Promise((r) => setTimeout(r, 10));

		expect(mockFetch).toHaveBeenCalledTimes(2);
	});

	test("uses separate cache slots for different API keys", async () => {
		await syncFlowGraphs([GRAPH_A], "https://api.test", "key-1");
		await new Promise((r) => setTimeout(r, 10));

		expect(mockFetch).toHaveBeenCalledTimes(1);

		// Same graph but different API key should still sync
		await syncFlowGraphs([GRAPH_A], "https://api.test", "key-2");
		await new Promise((r) => setTimeout(r, 10));

		expect(mockFetch).toHaveBeenCalledTimes(2);
	});

	test("skips sync for empty flow graphs", async () => {
		await syncFlowGraphs([], "https://api.test", "key-1");
		await new Promise((r) => setTimeout(r, 10));

		expect(mockFetch).toHaveBeenCalledTimes(0);
	});

	test("produces deterministic hash regardless of graph order", async () => {
		await syncFlowGraphs([GRAPH_A, GRAPH_B], "https://api.test", "key-1");
		await new Promise((r) => setTimeout(r, 10));

		expect(mockFetch).toHaveBeenCalledTimes(1);

		// Same graphs in reverse order should hit the cache
		await syncFlowGraphs([GRAPH_B, GRAPH_A], "https://api.test", "key-1");
		await new Promise((r) => setTimeout(r, 10));

		expect(mockFetch).toHaveBeenCalledTimes(1);
	});
});
