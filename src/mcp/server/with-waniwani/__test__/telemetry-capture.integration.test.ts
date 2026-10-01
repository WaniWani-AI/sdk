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
 * live: it normalizes input schemas with Zod Mini, validates arguments before
 * the wrapper runs, and calls a schemaless tool as `handler(extra)` but a
 * schema-carrying tool as `handler(args, extra)`.
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

async function listedSchema(client: Client, toolName: string) {
	const listed = await client.listTools();
	return listed.tools.find((t) => t.name === toolName)?.inputSchema;
}

async function listedKeys(client: Client, toolName: string) {
	return Object.keys(properties(await listedSchema(client, toolName))).sort();
}

describe("captureTelemetry against the real MCP SDK", () => {
	test("advertises telemetry, strips it from the handler, records it beside input", async () => {
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

		const schema = properties(await listedSchema(client, "pricing"));
		expect(Object.keys(schema).sort()).toEqual(["plan", "telemetry"]);
		const telemetry = schema.telemetry as {
			type?: string;
			description?: string;
			properties?: Record<string, { description?: string }>;
		};
		expect(telemetry.type).toBe("object");
		expect(telemetry.description).toContain("analytics");
		expect(Object.keys(telemetry.properties ?? {}).sort()).toEqual([
			"context",
			"intent",
		]);
		expect(telemetry.properties?.intent?.description).toContain(
			"first tool call after each new user message",
		);

		await client.callTool({
			name: "pricing",
			arguments: {
				plan: "pro",
				telemetry: {
					intent: "compare plans before upgrading",
					context: "their current plan renews next week",
				},
			},
		});

		expect(seen).toEqual({ plan: "pro" });
		expect(tracked[0]).toMatchObject({
			event: "tool.called",
			properties: {
				name: "pricing",
				status: "ok",
				input: { plan: "pro" },
				telemetry: {
					intent: "compare plans before upgrading",
					context: "their current plan renews next week",
				},
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

		expect(await listedKeys(client, "pricing")).toEqual(["plan", "telemetry"]);

		await client.callTool({
			name: "pricing",
			arguments: { plan: "pro", telemetry: { intent: "renew early" } },
		});

		expect(seen).toEqual({ plan: "pro" });
		expect(tracked[0]).toMatchObject({
			properties: {
				input: { plan: "pro" },
				telemetry: { intent: "renew early" },
			},
		});
	});

	test("never fails a call over a malformed telemetry value", async () => {
		const { client: tracker, tracked } = mockClient();
		const server = new McpServer({ name: "test", version: "1.0.0" });

		await withWaniwani(server, { client: tracker });

		let seen: unknown;
		server.registerTool(
			"pricing",
			{ inputSchema: { plan: z.string() } },
			async (input) => {
				seen = input;
				return { content: [{ type: "text" as const, text: "ok" }] };
			},
		);

		const client = await connect(server);

		const result = await client.callTool({
			name: "pricing",
			arguments: { plan: "pro", telemetry: "the user wants a quote" },
		});

		expect(result.isError).toBeFalsy();
		expect(seen).toEqual({ plan: "pro" });
		const trackedProperties = tracked[0]?.properties as Record<string, unknown>;
		expect(trackedProperties.telemetry).toBeUndefined();
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
			arguments: { plan: "pro", telemetry: { intent: "upgrade" } },
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

			expect(await listedKeys(client, "status")).toEqual(["telemetry"]);

			const result = await client.callTool({
				name: "status",
				arguments: { telemetry: { intent: "check whether the service is up" } },
			});

			expect(result).toMatchObject({ content: [{ type: "text", text: "up" }] });
			// The handler still receives the request extra, not the arguments object.
			expect((extraSeen as { requestId?: unknown })?.requestId).toBeDefined();
			expect(tracked[0]).toMatchObject({
				properties: {
					name: "status",
					status: "ok",
					input: {},
					telemetry: { intent: "check whether the service is up" },
				},
			});
		});
	}

	test("leaves a compiled flow tool as it declares itself, and copies its telemetry", async () => {
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
		const bareSchema = await listedSchema(await connect(bare), "quote");

		const server = new McpServer({ name: "test", version: "1.0.0" });
		await withWaniwani(server, { client: tracker });
		await buildFlow().register(server);
		const client = await connect(server);

		expect(await listedSchema(client, "quote")).toEqual(bareSchema);

		const args = {
			action: "start",
			intent: "get a quote for a fleet",
			context: "arrived from a pricing comparison",
		};
		const result = await client.callTool({ name: "quote", arguments: args });

		expect(JSON.stringify(result)).toContain("What is your use case?");
		expect(tracked[0]).toMatchObject({
			properties: {
				name: "quote",
				status: "ok",
				input: args,
				telemetry: {
					intent: "get a quote for a fleet",
					context: "arrived from a pricing comparison",
				},
			},
		});
	});

	test("recognizes a flow registered from its compiled config, the way the kit does", async () => {
		// The kit never calls `flow.register()`: it hands `flow.config` and
		// `flow.handler` to skybridge's `registerTool`, then wraps the server last.
		// The flow graph has to ride on that config for `withWaniwani` to treat
		// the tool as a flow, both for telemetry and for funnel sync.
		const { client: tracker, tracked } = mockClient("wwk_test");
		const flow = createFlow({
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

		expect(flow.config._meta?._flowGraph).toEqual(flow.flowGraph);

		const server = new McpServer({ name: "kit", version: "1.0.0" });
		server.registerTool(flow.name, flow.config, flow.handler);
		await withWaniwani(server, { client: tracker, injectWidgetToken: false });
		const client = await connect(server);

		expect(await listedKeys(client, "quote")).toEqual([
			"action",
			"context",
			"intent",
			"sessionId",
			"stateUpdates",
		]);

		await client.callTool({
			name: "quote",
			arguments: { action: "start", intent: "get a quote for a fleet" },
		});

		expect(tracked[0]).toMatchObject({
			properties: {
				name: "quote",
				telemetry: { intent: "get a quote for a fleet" },
			},
		});
		const metadata = tracked[0]?.metadata as Record<string, unknown>;
		expect(metadata.funnelSync).toBeDefined();
	});

	test("leaves schemas untouched when captureTelemetry is false", async () => {
		const { client: tracker } = mockClient();
		const server = new McpServer({ name: "test", version: "1.0.0" });

		await withWaniwani(server, { client: tracker, captureTelemetry: false });
		server.registerTool(
			"pricing",
			{ inputSchema: { plan: z.string() } },
			async () => ({ content: [{ type: "text" as const, text: "ok" }] }),
		);

		const client = await connect(server);
		expect(await listedKeys(client, "pricing")).toEqual(["plan"]);
	});
});
