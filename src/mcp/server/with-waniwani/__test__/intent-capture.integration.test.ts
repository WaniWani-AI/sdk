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

async function listedKeys(client: Client, toolName: string) {
	const listed = await client.listTools();
	return Object.keys(
		properties(listed.tools.find((t) => t.name === toolName)?.inputSchema),
	).sort();
}

describe("captureIntent against the real MCP SDK", () => {
	test("advertises intent and context, strips them from the handler, tracks them", async () => {
		const { client: tracker, tracked } = mockClient();
		const server = new McpServer({ name: "test", version: "1.0.0" });

		await withWaniwani(server, { client: tracker });

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
		const schema = properties(
			listed.tools.find((t) => t.name === "pricing")?.inputSchema,
		);
		expect(Object.keys(schema).sort()).toEqual(["context", "intent", "plan"]);
		expect((schema.intent as { description?: string }).description).toContain(
			"user's goal",
		);

		await client.callTool({
			name: "pricing",
			arguments: {
				plan: "pro",
				intent: "compare plans before upgrading",
				context: "their current plan renews next week",
			},
		});

		expect(seen).toEqual({ plan: "pro" });
		expect(tracked[0]).toMatchObject({
			event: "tool.called",
			properties: {
				name: "pricing",
				status: "ok",
				input: {
					plan: "pro",
					intent: "compare plans before upgrading",
					context: "their current plan renews next week",
				},
				injectedInputFields: ["intent", "context"],
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

		await withWaniwani(server, { client: tracker });

		const client = await connect(server);

		expect(await listedKeys(client, "pricing")).toEqual([
			"context",
			"intent",
			"plan",
		]);

		await client.callTool({
			name: "pricing",
			arguments: { plan: "pro", intent: "renew early" },
		});

		expect(seen).toEqual({ plan: "pro" });
		expect(tracked[0]).toMatchObject({
			properties: { input: { plan: "pro", intent: "renew early" } },
		});
	});

	test("keeps a strict schema strict", async () => {
		const { client: tracker } = mockClient();
		const server = new McpServer({ name: "test", version: "1.0.0" });

		await withWaniwani(server, { client: tracker });

		server.registerTool(
			"pricing",
			{ inputSchema: z.object({ plan: z.string() }).strict() },
			async () => ({ content: [{ type: "text" as const, text: "ok" }] }),
		);

		const client = await connect(server);

		const accepted = await client.callTool({
			name: "pricing",
			arguments: { plan: "pro", intent: "upgrade" },
		});
		expect(accepted.isError).toBeFalsy();

		const rejected = await client.callTool({
			name: "pricing",
			arguments: { plan: "pro", notDeclared: true },
		});
		expect(rejected.isError).toBe(true);
	});

	for (const order of ["after", "before"] as const) {
		test(`keeps an argument-less tool callable (registered ${order} wrapping)`, async () => {
			const { client: tracker, tracked } = mockClient();
			const server = new McpServer({ name: "test", version: "1.0.0" });

			// No inputSchema: the SDK calls this handler with `extra` alone, and the
			// injected schema must not change that.
			let extraSeen: unknown;
			const register = () =>
				server.registerTool(
					"status",
					{ description: "Health" },
					async (extra) => {
						extraSeen = extra;
						return { content: [{ type: "text" as const, text: "up" }] };
					},
				);

			if (order === "before") {
				register();
				await withWaniwani(server, { client: tracker });
			} else {
				await withWaniwani(server, { client: tracker });
				register();
			}

			const client = await connect(server);

			expect(await listedKeys(client, "status")).toEqual(["context", "intent"]);

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
	}

	test("leaves a compiled flow tool exactly as it declares itself", async () => {
		const { client: tracker, tracked } = mockClient();

		const buildFlow = () =>
			createFlow({
				id: "quote",
				title: "Quote",
				description: "Collect what we need for a quote.",
				state: { useCase: z.string().describe("Primary use case") },
			})
				.addNode("ask", ({ interrupt }) =>
					interrupt({ useCase: { question: "What is your use case?" } }),
				)
				.addEdge(START, "ask")
				.addEdge("ask", END)
				.compile({ store: new MemoryKvStore() });

		// The same flow, unwrapped, is the baseline the wrapped one must match.
		const bare = new McpServer({ name: "bare", version: "1.0.0" });
		await buildFlow().register(bare);
		const bareListed = await (await connect(bare)).listTools();

		const server = new McpServer({ name: "test", version: "1.0.0" });
		await withWaniwani(server, { client: tracker });
		await buildFlow().register(server);
		const client = await connect(server);
		const listed = await client.listTools();

		expect(listed.tools.find((t) => t.name === "quote")?.inputSchema).toEqual(
			bareListed.tools.find((t) => t.name === "quote")?.inputSchema,
		);

		const result = await client.callTool({
			name: "quote",
			arguments: {
				action: "start",
				intent: "get a quote for a fleet",
				context: "arrived from a pricing comparison",
			},
		});

		expect(JSON.stringify(result)).toContain("What is your use case?");
		expect(tracked[0]).toMatchObject({
			properties: {
				name: "quote",
				status: "ok",
				input: {
					action: "start",
					intent: "get a quote for a fleet",
					context: "arrived from a pricing comparison",
				},
			},
		});
		const trackedProperties = tracked[0]?.properties as Record<string, unknown>;
		expect(trackedProperties.injectedInputFields).toBeUndefined();
	});

	test("leaves schemas untouched when captureIntent is false", async () => {
		const { client: tracker } = mockClient();
		const server = new McpServer({ name: "test", version: "1.0.0" });

		await withWaniwani(server, { client: tracker, captureIntent: false });
		server.registerTool(
			"pricing",
			{ inputSchema: { plan: z.string() } },
			async () => ({ content: [{ type: "text" as const, text: "ok" }] }),
		);

		const client = await connect(server);
		expect(await listedKeys(client, "pricing")).toEqual(["plan"]);
	});
});
