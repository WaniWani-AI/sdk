import { describe, expect, test } from "bun:test";
import type { ScopedWaniWaniClient } from "../../scoped-client";
import type { Edge, NodeHandler } from "../@types";
import { END, interrupt, showWidget } from "../@types";
import { executeFrom } from "../execute";

type State = Record<string, unknown>;

function fakeClient() {
	const tracked: Array<{
		event: string;
		properties?: Record<string, unknown>;
	}> = [];
	const client = {
		track: async (input: {
			event: string;
			properties?: Record<string, unknown>;
		}) => {
			tracked.push(input);
			return { eventId: "evt_test" };
		},
	};
	return { tracked, client: client as unknown as ScopedWaniWaniClient };
}

describe("executeFrom reports session errors", () => {
	test("a throwing step handler reports agent_failed and still returns the error result", async () => {
		const { tracked, client } = fakeClient();
		const nodes = new Map<string, NodeHandler<State>>([
			[
				"start",
				async () => {
					throw new Error("partner API exploded");
				},
			],
		]);

		const result = await executeFrom(
			"start",
			{},
			nodes,
			new Map<string, Edge<State>>(),
			new Map(),
			undefined,
			client,
		);

		expect(result.content.status).toBe("error");
		if (result.content.status !== "error") {
			throw new Error("expected error content");
		}
		expect(result.content.error).toBe("partner API exploded");
		expect(result.flowTokenContent).toEqual({ step: "start", state: {} });
		expect(tracked).toHaveLength(1);
		expect(tracked[0].event).toBe("session.error");
		expect(tracked[0].properties?.code).toBe("agent_failed");
		expect(tracked[0].properties?.cause).toBe("unknown");
		expect(tracked[0].properties?.node).toBe("start");
	});

	test("an unknown node reports and returns the same error result", async () => {
		const { tracked, client } = fakeClient();

		const result = await executeFrom(
			"missing",
			{},
			new Map<string, NodeHandler<State>>(),
			new Map<string, Edge<State>>(),
			new Map(),
			undefined,
			client,
		);

		expect(result.content.status).toBe("error");
		expect(tracked).toHaveLength(1);
		expect(tracked[0].properties?.code).toBe("agent_failed");
		expect(tracked[0].properties?.cause).toBe("flow_unknown_node");
	});

	test("a dead end reports", async () => {
		const { tracked, client } = fakeClient();
		const nodes = new Map<string, NodeHandler<State>>([
			["start", async () => ({})],
		]);

		const result = await executeFrom(
			"start",
			{},
			nodes,
			new Map<string, Edge<State>>(),
			new Map(),
			undefined,
			client,
		);

		expect(result.content.status).toBe("error");
		if (result.content.status !== "error") {
			throw new Error("expected error content");
		}
		expect(result.content.error).toBe('No outgoing edge from node "start"');
		expect(tracked).toHaveLength(1);
		expect(tracked[0].properties?.code).toBe("agent_failed");
		expect(tracked[0].properties?.cause).toBe("flow_dead_end");
	});

	test("a dead end reached after an already-answered interrupt reports", async () => {
		const { tracked, client } = fakeClient();
		const nodes = new Map<string, NodeHandler<State>>([
			[
				"start",
				async () => interrupt({ name: { question: "What's your name?" } }),
			],
		]);

		const result = await executeFrom(
			"start",
			{ name: "Ada" },
			nodes,
			new Map<string, Edge<State>>(),
			new Map(),
			undefined,
			client,
		);

		expect(result.content.status).toBe("error");
		expect(tracked).toHaveLength(1);
		expect(tracked[0].properties?.code).toBe("agent_failed");
		expect(tracked[0].properties?.cause).toBe("flow_dead_end");
	});

	test("a dead end reached after an auto-skipped widget reports", async () => {
		const { tracked, client } = fakeClient();
		const nodes = new Map<string, NodeHandler<State>>([
			["start", async () => showWidget({ tool: "plan_picker", field: "plan" })],
		]);

		const result = await executeFrom(
			"start",
			{ plan: "pro" },
			nodes,
			new Map<string, Edge<State>>(),
			new Map(),
			undefined,
			client,
		);

		expect(result.content.status).toBe("error");
		expect(tracked).toHaveLength(1);
		expect(tracked[0].properties?.code).toBe("agent_failed");
		expect(tracked[0].properties?.cause).toBe("flow_dead_end");
	});

	test("the iteration cap reports and returns the cap error", async () => {
		const { tracked, client } = fakeClient();
		const nodes = new Map<string, NodeHandler<State>>([
			["a", async () => ({})],
			["b", async () => ({})],
		]);
		const edges = new Map<string, Edge<State>>([
			["a", { type: "direct", to: "b" }],
			["b", { type: "direct", to: "a" }],
		]);

		const result = await executeFrom(
			"a",
			{},
			nodes,
			edges,
			new Map(),
			undefined,
			client,
		);

		expect(result.content.status).toBe("error");
		if (result.content.status !== "error") {
			throw new Error("expected error content");
		}
		expect(result.content.error).toBe(
			"Flow exceeded maximum iterations (possible infinite loop)",
		);
		expect(tracked).toHaveLength(1);
		expect(tracked[0].properties?.code).toBe("agent_failed");
		expect(tracked[0].properties?.cause).toBe("flow_loop");
	});

	test("a healthy flow reports nothing", async () => {
		const { tracked, client } = fakeClient();
		const nodes = new Map<string, NodeHandler<State>>([
			["start", async () => ({})],
		]);
		const edges = new Map<string, Edge<State>>([
			["start", { type: "direct", to: END }],
		]);

		const result = await executeFrom(
			"start",
			{},
			nodes,
			edges,
			new Map(),
			undefined,
			client,
		);

		expect(result.content.status).toBe("complete");
		expect(tracked).toHaveLength(0);
	});

	test("a flow with no client does not throw", async () => {
		const nodes = new Map<string, NodeHandler<State>>([
			[
				"start",
				async () => {
					throw new Error("boom");
				},
			],
		]);

		const result = await executeFrom(
			"start",
			{},
			nodes,
			new Map<string, Edge<State>>(),
			new Map(),
		);

		expect(result.content.status).toBe("error");
	});

	test("a client whose track throws synchronously does not turn a dead end into a rejection", async () => {
		const throwingClient = {
			track: () => {
				throw new Error("client track blew up");
			},
		} as unknown as ScopedWaniWaniClient;
		const nodes = new Map<string, NodeHandler<State>>([
			["start", async () => ({})],
		]);

		const result = await executeFrom(
			"start",
			{},
			nodes,
			new Map<string, Edge<State>>(),
			new Map(),
			undefined,
			throwingClient,
		);

		expect(result.content.status).toBe("error");
		if (result.content.status !== "error") {
			throw new Error("expected error content");
		}
		expect(result.content.error).toBe('No outgoing edge from node "start"');
	});
});
