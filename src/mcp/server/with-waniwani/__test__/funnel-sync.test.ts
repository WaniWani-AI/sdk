import { describe, expect, test } from "bun:test";
import type { FlowGraph } from "../../flows/@types.js";
import { prepareFunnelSyncPayload } from "../funnel-sync.js";

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

describe("prepareFunnelSyncPayload", () => {
	test("returns null for empty flow graphs", async () => {
		const result = await prepareFunnelSyncPayload([]);
		expect(result).toBeNull();
	});

	test("returns composite hash and per-flow hashes", async () => {
		const result = await prepareFunnelSyncPayload([GRAPH_A]);
		expect(result).not.toBeNull();
		expect(result?.compositeHash).toBeTypeOf("string");
		expect(result?.compositeHash.length).toBeGreaterThan(0);
		expect(result?.flows).toHaveLength(1);
		expect(result?.flows[0].flowId).toBe("flow-a");
		expect(result?.flows[0].configHash).toBeTypeOf("string");
	});

	test("produces deterministic hash regardless of graph order", async () => {
		const resultAB = await prepareFunnelSyncPayload([GRAPH_A, GRAPH_B]);
		const resultBA = await prepareFunnelSyncPayload([GRAPH_B, GRAPH_A]);
		expect(resultAB?.compositeHash).toBe(resultBA?.compositeHash);
	});

	test("produces different hash for different graphs", async () => {
		const resultA = await prepareFunnelSyncPayload([GRAPH_A]);
		const resultB = await prepareFunnelSyncPayload([GRAPH_B]);
		expect(resultA?.compositeHash).not.toBe(resultB?.compositeHash);
	});
});
