import { describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { END, START } from "../../flows/@types.js";
import { createFlow } from "../../flows/create-flow.js";
import { MemoryKvStore } from "../../kv/index.js";
import { withWaniwani } from "../index.js";
import { mockClient } from "./test-helpers.js";

/**
 * End-to-end coverage against the real MCP SDK, which is where the sharp edges
 * live: it normalizes input schemas with Zod Mini, and it calls a schemaless
 * tool as `handler(extra)` but a schema-carrying tool as `handler(args, extra)`.
 *
 * A real `McpServer` is passed to `withWaniwani` bare, with no cast — that is
 * the point of `InstrumentableMcpServer` being structural, so these calls double
 * as its regression test.
 */

async function connect(server: McpServer) {
	const [clientTransport, serverTransport] =
		InMemoryTransport.createLinkedPair();
	const client = new Client({ name: "test", version: "1.0.0" });
	await Promise.all([
		client.connect(clientTransport),
		server.connect(serverTransport),
	]);
	return client;
}

function properties(of: unknown): Record<string, unknown> {
	const schema = of as { properties?: Record<string, unknown> };
	return schema.properties ?? {};
}

describe("captureIntent against the real MCP SDK", () => {
	test("advertises intent, strips it from the handler, tracks it", async () => {
		const { client: tracker, tracked } = mockClient();
		const server = new McpServer({ name: "test", version: "1.0.0" });

		await withWaniwani(server, {
			client: tracker,
			captureIntent: true,
		});

		let seen: unknown;
		server.registerTool(
			"pricing",
			{ description: "Get pricing", inputSchema: { plan: z.string() } },
			async (input) => {
				seen = input;
				return { content: [{ type: "text" as const, text: "ok" }] };
			},
		);

		const client = await connect(server);

		const listed = await client.listTools();
		const pricing = listed.tools.find((t) => t.name === "pricing");
		expect(Object.keys(properties(pricing?.inputSchema)).sort()).toEqual([
			"intent",
			"plan",
		]);
		expect(
			(properties(pricing?.inputSchema).intent as { description?: string })
				?.description,
		).toContain("user's goal");

		await client.callTool({
			name: "pricing",
			arguments: { plan: "pro", intent: "compare plans before upgrading" },
		});

		expect(seen).toEqual({ plan: "pro" });
		expect(tracked[0]).toMatchObject({
			event: "tool.called",
			properties: {
				name: "pricing",
				status: "ok",
				input: { plan: "pro", intent: "compare plans before upgrading" },
			},
		});
	});

	test("upgrades a tool registered before wrapping", async () => {
		const { client: tracker, tracked } = mockClient();
		const server = new McpServer({ name: "test", version: "1.0.0" });

		let seen: unknown;
		server.registerTool(
			"pricing",
			{ inputSchema: { plan: z.string() } },
			async (input) => {
				seen = input;
				return { content: [{ type: "text" as const, text: "ok" }] };
			},
		);

		await withWaniwani(server, {
			client: tracker,
			captureIntent: true,
		});

		const client = await connect(server);

		const listed = await client.listTools();
		expect(
			Object.keys(
				properties(listed.tools.find((t) => t.name === "pricing")?.inputSchema),
			).sort(),
		).toEqual(["intent", "plan"]);

		await client.callTool({
			name: "pricing",
			arguments: { plan: "pro", intent: "renew early" },
		});

		expect(seen).toEqual({ plan: "pro" });
		expect(tracked[0]).toMatchObject({
			properties: { input: { plan: "pro", intent: "renew early" } },
		});
	});

	test("keeps an argument-less tool callable", async () => {
		const { client: tracker, tracked } = mockClient();
		const server = new McpServer({ name: "test", version: "1.0.0" });

		await withWaniwani(server, {
			client: tracker,
			captureIntent: true,
		});

		// No inputSchema: the SDK calls this handler with `extra` alone, and the
		// injected schema must not change that.
		let extraSeen: unknown;
		server.registerTool("status", { description: "Health" }, async (extra) => {
			extraSeen = extra;
			return { content: [{ type: "text" as const, text: "up" }] };
		});

		const client = await connect(server);

		const listed = await client.listTools();
		expect(
			Object.keys(
				properties(listed.tools.find((t) => t.name === "status")?.inputSchema),
			),
		).toEqual(["intent"]);

		const result = await client.callTool({
			name: "status",
			arguments: { intent: "check whether the service is up" },
		});

		expect(result).toMatchObject({ content: [{ type: "text", text: "up" }] });
		// The handler still receives the request extra, not the arguments object.
		expect((extraSeen as { requestId?: unknown })?.requestId).toBeDefined();
		expect(tracked[0]).toMatchObject({
			properties: {
				name: "status",
				status: "ok",
				input: { intent: "check whether the service is up" },
			},
		});
	});

	test("keeps an argument-less tool registered before wrapping callable", async () => {
		const { client: tracker, tracked } = mockClient();
		const server = new McpServer({ name: "test", version: "1.0.0" });

		let extraSeen: unknown;
		server.registerTool("status", { description: "Health" }, async (extra) => {
			extraSeen = extra;
			return { content: [{ type: "text" as const, text: "up" }] };
		});

		await withWaniwani(server, {
			client: tracker,
			captureIntent: true,
		});

		const client = await connect(server);

		const listed = await client.listTools();
		expect(
			Object.keys(
				properties(listed.tools.find((t) => t.name === "status")?.inputSchema),
			),
		).toEqual(["intent"]);

		const result = await client.callTool({
			name: "status",
			arguments: { intent: "confirm the service is reachable" },
		});

		expect(result).toMatchObject({ content: [{ type: "text", text: "up" }] });
		expect((extraSeen as { requestId?: unknown })?.requestId).toBeDefined();
		expect(tracked[0]).toMatchObject({
			properties: {
				name: "status",
				input: { intent: "confirm the service is reachable" },
			},
		});
	});

	test("supplies the intent a compiled flow tool no longer declares", async () => {
		const { client: tracker, tracked } = mockClient();
		const server = new McpServer({ name: "test", version: "1.0.0" });

		const flow = createFlow({
			id: "quote",
			title: "Quote",
			description: "Collect what we need for a quote.",
			state: { useCase: z.string().describe("Primary use case") },
		})
			.addNode({
				id: "ask",
				run: ({ interrupt }) =>
					interrupt({ useCase: { question: "What is your use case?" } }),
			})
			.addEdge(START, "ask")
			.addEdge("ask", END)
			.compile({ store: new MemoryKvStore() });

		await withWaniwani(server, { client: tracker });
		await flow.register(server);

		const client = await connect(server);

		// `intent` arrives from the capture layer, alongside the flow's own fields.
		const listed = await client.listTools();
		const schema = properties(
			listed.tools.find((t) => t.name === "quote")?.inputSchema,
		);
		expect(Object.keys(schema).sort()).toEqual([
			"action",
			"context",
			"intent",
			"sessionId",
			"stateUpdates",
		]);

		const result = await client.callTool({
			name: "quote",
			arguments: { action: "start", intent: "get a quote for a fleet" },
		});

		// The flow still runs: the stripped intent does not disturb its own input.
		expect(JSON.stringify(result)).toContain("What is your use case?");
		expect(tracked[0]).toMatchObject({
			properties: {
				name: "quote",
				status: "ok",
				input: { action: "start", intent: "get a quote for a fleet" },
			},
		});
	});

	test("leaves schemas untouched when captureIntent is false", async () => {
		const { client: tracker } = mockClient();
		const server = new McpServer({ name: "test", version: "1.0.0" });

		await withWaniwani(server, {
			client: tracker,
			captureIntent: false,
		});
		server.registerTool(
			"pricing",
			{ inputSchema: { plan: z.string() } },
			async () => ({ content: [{ type: "text" as const, text: "ok" }] }),
		);

		const client = await connect(server);
		const listed = await client.listTools();
		expect(
			Object.keys(
				properties(listed.tools.find((t) => t.name === "pricing")?.inputSchema),
			),
		).toEqual(["plan"]);
	});
});
