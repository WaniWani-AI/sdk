import { describe, expect, test } from "bun:test";
import { z } from "zod";
import type { ScopedWaniWaniClient } from "../../scoped-client";
import { SCOPED_CLIENT_KEY } from "../../scoped-client";
import type { FlowTokenContent, McpServer } from "../@types";
import { END, START } from "../@types";
import { compileFlow } from "../compile";
import { createFlow } from "../create-flow";
import type { FlowStore } from "../flow-store";

type Handler = (input: unknown, extra: unknown) => Promise<unknown>;
type RegisterToolArgs = [string, Record<string, unknown>, Handler];

type FlowErrorPayload = { status: "error"; error: string };

function isErrorPayload(
	payload: Record<string, unknown>,
): payload is FlowErrorPayload {
	return payload.status === "error" && typeof payload.error === "string";
}

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

function mockServer() {
	const registered: RegisterToolArgs[] = [];
	const server = {
		registerTool: (...args: unknown[]) => {
			registered.push(args as RegisterToolArgs);
		},
	};
	return { server: server as unknown as McpServer, registered };
}

function extraWithClient({
	sessionId,
	client,
}: {
	sessionId: string;
	client: ScopedWaniWaniClient;
}) {
	return { _meta: { sessionId }, [SCOPED_CLIENT_KEY]: client };
}

function parsePayload(result: Record<string, unknown>) {
	const content = result.content as Array<{ type: string; text?: string }>;
	return JSON.parse(content[0]?.text ?? "") as Record<string, unknown>;
}

function upstreamError({
	message,
	status,
}: {
	message: string;
	status: number;
}): Error {
	return Object.assign(new Error(message), { status });
}

class MemoryFlowStore implements FlowStore {
	private readonly map = new Map<string, FlowTokenContent>();
	async get(key: string): Promise<FlowTokenContent | null> {
		return this.map.get(key) ?? null;
	}
	async set(key: string, value: FlowTokenContent): Promise<void> {
		this.map.set(key, value);
	}
	async delete(key: string): Promise<void> {
		this.map.delete(key);
	}
}

class ThrowingGetStore implements FlowStore {
	constructor(private readonly error: Error) {}
	async get(): Promise<FlowTokenContent | null> {
		throw this.error;
	}
	async set(): Promise<void> {}
	async delete(): Promise<void> {}
}

class ThrowingSetStore implements FlowStore {
	constructor(private readonly error: Error) {}
	async get(): Promise<FlowTokenContent | null> {
		return null;
	}
	async set(): Promise<void> {
		throw this.error;
	}
	async delete(): Promise<void> {}
}

class FixedGetStore implements FlowStore {
	constructor(private readonly value: FlowTokenContent) {}
	async get(): Promise<FlowTokenContent | null> {
		return this.value;
	}
	async set(): Promise<void> {}
	async delete(): Promise<void> {}
}

function askNameFlow(store: FlowStore) {
	return createFlow({
		id: "ask_name_flow",
		title: "Ask Name Flow",
		description: "A single-node flow that asks for a name.",
		state: { name: z.string().describe("The user's name") },
	})
		.addNode("ask_name", ({ interrupt }) =>
			interrupt({ name: { question: "What's your name?" } }),
		)
		.addEdge(START, "ask_name")
		.addEdge("ask_name", END)
		.compile({ store });
}

describe("compileFlow reports session errors", () => {
	test("starting a flow whose graph has no start edge reports and returns the same error", async () => {
		const { tracked, client } = fakeClient();
		const flow = compileFlow<Record<string, unknown>>({
			config: {
				id: "no_start_edge_flow",
				title: "No Start Edge Flow",
				description: "A flow with no start edge, for testing.",
				state: {},
			},
			nodes: new Map(),
			edges: new Map(),
			store: new MemoryFlowStore(),
			graph: () => "flowchart TD",
			nodeOptions: new Map(),
		});

		const { server, registered } = mockServer();
		await flow.register(server);
		const handler = registered[0]?.[2];

		const result = (await handler?.(
			{ action: "start", intent: "test" },
			extraWithClient({ sessionId: "sess-1", client }),
		)) as Record<string, unknown>;
		const parsed = parsePayload(result);

		expect(parsed.status).toBe("error");
		if (!isErrorPayload(parsed)) {
			throw new Error("expected error payload");
		}
		expect(parsed.error).toBe("No start edge");
		expect(tracked).toHaveLength(1);
		expect(tracked[0].event).toBe("session.error");
		expect(tracked[0].properties?.code).toBe("agent_failed");
		expect(tracked[0].properties?.cause).toBe("flow_dead_end");
		expect(tracked[0].properties?.node).toBe(START);
	});

	test("resetting a flow whose graph has no start edge reports and returns the same error", async () => {
		const { tracked, client } = fakeClient();
		const flow = compileFlow<Record<string, unknown>>({
			config: {
				id: "no_start_edge_flow_reset",
				title: "No Start Edge Flow (reset)",
				description: "A flow with no start edge, for testing reset.",
				state: {},
			},
			nodes: new Map(),
			edges: new Map(),
			store: new FixedGetStore({ step: "ask_name", state: {} }),
			graph: () => "flowchart TD",
			nodeOptions: new Map(),
		});

		const { server, registered } = mockServer();
		await flow.register(server);
		const handler = registered[0]?.[2];

		const result = (await handler?.(
			{ action: "reset", stateUpdates: { name: "Ada" } },
			extraWithClient({ sessionId: "sess-1", client }),
		)) as Record<string, unknown>;
		const parsed = parsePayload(result);

		expect(parsed.status).toBe("error");
		if (!isErrorPayload(parsed)) {
			throw new Error("expected error payload");
		}
		expect(parsed.error).toBe("No start edge");
		expect(tracked).toHaveLength(1);
		expect(tracked[0].properties?.code).toBe("agent_failed");
		expect(tracked[0].properties?.cause).toBe("flow_dead_end");
		expect(tracked[0].properties?.node).toBe(START);
	});

	test("a store outage on continue's load reports upstream_failed and returns the same error", async () => {
		const { tracked, client } = fakeClient();
		const store = new ThrowingGetStore(new Error("boom"));
		const flow = askNameFlow(store);

		const { server, registered } = mockServer();
		await flow.register(server);
		const handler = registered[0]?.[2];

		const result = (await handler?.(
			{ action: "continue" },
			extraWithClient({ sessionId: "sess-1", client }),
		)) as Record<string, unknown>;
		const parsed = parsePayload(result);

		expect(parsed.status).toBe("error");
		if (!isErrorPayload(parsed)) {
			throw new Error("expected error payload");
		}
		expect(parsed.error).toBe(
			'Failed to load flow state (session "sess-1"): boom',
		);
		expect(tracked).toHaveLength(1);
		expect(tracked[0].properties?.code).toBe("upstream_failed");
		expect(tracked[0].properties?.cause).toBe("unknown");
		expect(tracked[0].properties?.node).toBeUndefined();
	});

	test("a store outage on reset's load reports upstream_failed with the classified cause", async () => {
		const { tracked, client } = fakeClient();
		const store = new ThrowingGetStore(
			upstreamError({ message: "gateway down", status: 503 }),
		);
		const flow = askNameFlow(store);

		const { server, registered } = mockServer();
		await flow.register(server);
		const handler = registered[0]?.[2];

		const result = (await handler?.(
			{ action: "reset", stateUpdates: { name: "Ada" } },
			extraWithClient({ sessionId: "sess-1", client }),
		)) as Record<string, unknown>;
		const parsed = parsePayload(result);

		expect(parsed.status).toBe("error");
		if (!isErrorPayload(parsed)) {
			throw new Error("expected error payload");
		}
		expect(parsed.error).toBe(
			'Failed to load flow state (session "sess-1"): gateway down',
		);
		expect(tracked).toHaveLength(1);
		expect(tracked[0].properties?.code).toBe("upstream_failed");
		expect(tracked[0].properties?.cause).toBe("upstream_5xx");
		expect(tracked[0].properties?.node).toBeUndefined();
	});

	test("a widget continue with no outgoing edge from its step reports flow_dead_end", async () => {
		const { tracked, client } = fakeClient();
		const flow = compileFlow<Record<string, unknown>>({
			config: {
				id: "widget_dead_end_flow",
				title: "Widget Dead End Flow",
				description: "A flow whose widget step has no outgoing edge.",
				state: {},
			},
			nodes: new Map(),
			edges: new Map(),
			store: new FixedGetStore({
				step: "widget_step",
				state: {},
				widgetId: "plan_picker",
			}),
			graph: () => "flowchart TD",
			nodeOptions: new Map(),
		});

		const { server, registered } = mockServer();
		await flow.register(server);
		const handler = registered[0]?.[2];

		const result = (await handler?.(
			{ action: "continue" },
			extraWithClient({ sessionId: "sess-1", client }),
		)) as Record<string, unknown>;
		const parsed = parsePayload(result);

		expect(parsed.status).toBe("error");
		if (!isErrorPayload(parsed)) {
			throw new Error("expected error payload");
		}
		expect(parsed.error).toBe('No edge from step "widget_step"');
		expect(tracked).toHaveLength(1);
		expect(tracked[0].properties?.code).toBe("agent_failed");
		expect(tracked[0].properties?.cause).toBe("flow_dead_end");
		expect(tracked[0].properties?.node).toBe("widget_step");
	});

	test("a store outage while persisting flow state reports upstream_failed and returns the same error", async () => {
		const { tracked, client } = fakeClient();
		const store = new ThrowingSetStore(new TypeError("fetch failed"));
		const flow = askNameFlow(store);

		const { server, registered } = mockServer();
		await flow.register(server);
		const handler = registered[0]?.[2];

		const result = (await handler?.(
			{ action: "start", intent: "test" },
			extraWithClient({ sessionId: "sess-1", client }),
		)) as Record<string, unknown>;
		const parsed = parsePayload(result);

		expect(parsed.status).toBe("error");
		if (!isErrorPayload(parsed)) {
			throw new Error("expected error payload");
		}
		expect(parsed.error).toBe(
			'Flow state failed to persist (session "sess-1"): fetch failed',
		);
		expect(result.isError).toBe(true);
		expect(tracked).toHaveLength(1);
		expect(tracked[0].properties?.code).toBe("upstream_failed");
		expect(tracked[0].properties?.cause).toBe("network");
		expect(tracked[0].properties?.node).toBe("ask_name");
	});
});

describe("compileFlow does not report expected conditions", () => {
	test("continuing an unknown or expired session reports nothing", async () => {
		const { tracked, client } = fakeClient();
		const flow = askNameFlow(new MemoryFlowStore());

		const { server, registered } = mockServer();
		await flow.register(server);
		const handler = registered[0]?.[2];

		const result = (await handler?.(
			{ action: "continue" },
			extraWithClient({ sessionId: "does-not-exist", client }),
		)) as Record<string, unknown>;
		const parsed = parsePayload(result);

		expect(parsed.status).toBe("error");
		if (!isErrorPayload(parsed)) {
			throw new Error("expected error payload");
		}
		expect(parsed.error).toBe(
			'Flow state not found for session "does-not-exist". The flow may have expired.',
		);
		expect(tracked).toHaveLength(0);
	});

	test("an unknown action reports nothing", async () => {
		const { tracked, client } = fakeClient();
		const flow = askNameFlow(new MemoryFlowStore());

		const { server, registered } = mockServer();
		await flow.register(server);
		const handler = registered[0]?.[2];

		const result = (await handler?.(
			{ action: "bogus" },
			extraWithClient({ sessionId: "sess-1", client }),
		)) as Record<string, unknown>;
		const parsed = parsePayload(result);

		expect(parsed.status).toBe("error");
		if (!isErrorPayload(parsed)) {
			throw new Error("expected error payload");
		}
		expect(parsed.error).toBe('Unknown action: "bogus"');
		expect(tracked).toHaveLength(0);
	});
});
