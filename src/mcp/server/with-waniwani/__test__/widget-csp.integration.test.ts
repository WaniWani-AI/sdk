import { describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
	McpServer,
	ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { withWaniwani } from "../index.js";
import { mockClient } from "./test-helpers.js";

const EU_API_URL = "https://eu.app.waniwani.ai/";
const EU_ORIGIN = "https://eu.app.waniwani.ai";

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

function euTracker() {
	const { client } = mockClient();
	return { ...client, _config: { ...client._config, apiUrl: EU_API_URL } };
}

async function readMeta(client: Client, uri: string) {
	const result = await client.readResource({ uri });
	return result.contents[0]?._meta as Record<string, unknown> | undefined;
}

function widget(uri: string, meta?: Record<string, unknown>) {
	return async () => ({
		contents: [
			{
				uri,
				mimeType: "text/html;profile=mcp-app",
				text: "<div></div>",
				...(meta && { _meta: meta }),
			},
		],
	});
}

describe("withWaniwani widget CSP", () => {
	test("adds the tracking origin to a widget's ui.csp.connectDomains", async () => {
		const server = new McpServer({ name: "test", version: "1.0.0" });
		await withWaniwani(server, { client: euTracker() });

		const declared = {
			ui: {
				domain: "https://widget.example.com",
				csp: {
					connectDomains: ["https://api.example.com"],
					resourceDomains: ["https://cdn.example.com"],
				},
			},
		};
		server.registerResource(
			"card",
			"ui://card.html",
			{},
			widget("ui://card.html", declared),
		);

		const meta = await readMeta(await connect(server), "ui://card.html");
		expect(meta?.ui).toEqual({
			domain: "https://widget.example.com",
			csp: {
				connectDomains: ["https://api.example.com", EU_ORIGIN],
				resourceDomains: ["https://cdn.example.com"],
			},
		});
		expect(declared.ui.csp.connectDomains).toEqual(["https://api.example.com"]);
	});

	test("covers a resource registered before withWaniwani runs", async () => {
		const server = new McpServer({ name: "test", version: "1.0.0" });
		server.registerResource(
			"card",
			"ui://card.html",
			{},
			widget("ui://card.html", { ui: { csp: { connectDomains: [] } } }),
		);
		await withWaniwani(server, { client: euTracker() });

		const meta = await readMeta(await connect(server), "ui://card.html");
		expect(meta?.ui).toEqual({ csp: { connectDomains: [EU_ORIGIN] } });
	});

	test("covers a resource template", async () => {
		const server = new McpServer({ name: "test", version: "1.0.0" });
		await withWaniwani(server, { client: euTracker() });
		server.registerResource(
			"cards",
			new ResourceTemplate("ui://cards/{id}.html", { list: undefined }),
			{},
			async (uri) => widget(uri.href)(),
		);

		const meta = await readMeta(await connect(server), "ui://cards/7.html");
		expect(meta?.ui).toEqual({ csp: { connectDomains: [EU_ORIGIN] } });
	});

	test("extends openai/widgetCSP without adding a ui.csp block", async () => {
		const server = new McpServer({ name: "test", version: "1.0.0" });
		await withWaniwani(server, { client: euTracker() });
		server.registerResource("card", "ui://card.html", {}, async () => ({
			contents: [
				{
					uri: "ui://card.html",
					mimeType: "text/html+skybridge",
					text: "<div></div>",
					_meta: {
						"openai/widgetCSP": {
							connect_domains: ["https://api.example.com"],
							resource_domains: ["https://cdn.example.com"],
						},
					},
				},
			],
		}));

		const meta = await readMeta(await connect(server), "ui://card.html");
		expect(meta?.["openai/widgetCSP"]).toEqual({
			connect_domains: ["https://api.example.com", EU_ORIGIN],
			resource_domains: ["https://cdn.example.com"],
		});
		expect(meta?.ui).toBeUndefined();
	});

	test("extends both blocks when a widget declares both", async () => {
		const server = new McpServer({ name: "test", version: "1.0.0" });
		await withWaniwani(server, { client: euTracker() });
		server.registerResource(
			"card",
			"ui://card.html",
			{},
			widget("ui://card.html", {
				ui: { csp: { connectDomains: [EU_ORIGIN] } },
				"openai/widgetCSP": { resource_domains: [] },
			}),
		);

		const meta = await readMeta(await connect(server), "ui://card.html");
		expect(meta?.ui).toEqual({ csp: { connectDomains: [EU_ORIGIN] } });
		expect(meta?.["openai/widgetCSP"]).toEqual({
			resource_domains: [],
			connect_domains: [EU_ORIGIN],
		});
	});

	test("gives an HTML widget with no CSP a ui.csp block", async () => {
		const server = new McpServer({ name: "test", version: "1.0.0" });
		await withWaniwani(server, { client: euTracker() });
		server.registerResource(
			"card",
			"ui://card.html",
			{},
			widget("ui://card.html"),
		);

		const meta = await readMeta(await connect(server), "ui://card.html");
		expect(meta).toEqual({ ui: { csp: { connectDomains: [EU_ORIGIN] } } });
	});

	test("leaves non-widget resources untouched", async () => {
		const server = new McpServer({ name: "test", version: "1.0.0" });
		await withWaniwani(server, { client: euTracker() });
		server.registerResource("faq", "docs://faq", {}, async () => ({
			contents: [{ uri: "docs://faq", mimeType: "text/plain", text: "hi" }],
		}));

		const result = await (await connect(server)).readResource({
			uri: "docs://faq",
		});
		expect(result.contents[0]?._meta).toBeUndefined();
	});

	test("declares nothing when injectWidgetToken is false", async () => {
		const server = new McpServer({ name: "test", version: "1.0.0" });
		await withWaniwani(server, {
			client: euTracker(),
			injectWidgetToken: false,
		});
		server.registerResource(
			"card",
			"ui://card.html",
			{},
			widget("ui://card.html"),
		);

		const meta = await readMeta(await connect(server), "ui://card.html");
		expect(meta).toBeUndefined();
	});
});
