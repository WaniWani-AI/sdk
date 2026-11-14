import { describe, expect, test } from "bun:test";
import {
	appCallableTools,
	fetchMcpAppResource,
	resultProducesWidget,
} from "./mcp-app-frame";

describe("resultProducesWidget", () => {
	test("returns false for plain tool results with structured content but no widget metadata", () => {
		expect(
			resultProducesWidget({
				_meta: {
					some: "value",
				},
			}),
		).toBe(false);
	});

	test("returns true for MCP Apps widget metadata", () => {
		expect(
			resultProducesWidget({
				_meta: {
					ui: {
						resourceUri: "ui://widgets/ext-apps/example.html",
					},
				},
			}),
		).toBe(true);
	});

	test("returns true for OpenAI widget metadata", () => {
		expect(
			resultProducesWidget({
				_meta: {
					"openai/outputTemplate": "ui://widgets/apps-sdk/example.html",
				},
			}),
		).toBe(true);
	});

	test("returns false for helper-tool opt-out metadata", () => {
		expect(
			resultProducesWidget({
				_meta: {
					"waniwani/autoInjectResultText": false,
				},
			}),
		).toBe(false);
	});
});

describe("appCallableTools", () => {
	test("allows any tool when there is no catalog", () => {
		expect(appCallableTools(undefined).includes("anything")).toBe(true);
		expect(appCallableTools({}).includes("anything")).toBe(true);
	});

	test("leaves out tools whose visibility excludes the app", () => {
		expect(
			appCallableTools({
				plain: {},
				both: { _meta: { ui: { visibility: ["model", "app"] } } },
				appOnly: { _meta: { ui: { visibility: ["app"] } } },
				modelOnly: { _meta: { ui: { visibility: ["model"] } } },
			}),
		).toEqual(["plain", "both", "appOnly"]);
	});
});

describe("fetchMcpAppResource", () => {
	const fetchReturning = (response: Response, urls: string[] = []) =>
		(async (url: string) => {
			urls.push(url);
			return response;
		}) as unknown as typeof fetch;

	test("reads an HTML answer as the widget HTML", async () => {
		const urls: string[] = [];
		const resource = await fetchMcpAppResource(
			"/api/mcp/resource?token=t",
			"ui://w/a.html",
			fetchReturning(
				new Response("<p>w</p>", { headers: { "content-type": "text/html" } }),
				urls,
			),
		);
		expect(urls).toEqual([
			"/api/mcp/resource?token=t&uri=ui%3A%2F%2Fw%2Fa.html",
		]);
		expect(resource).toEqual({
			uri: "ui://w/a.html",
			mimeType: "text/html;profile=mcp-app",
			html: "<p>w</p>",
		});
	});

	test("reads a JSON answer with its metadata", async () => {
		const resource = await fetchMcpAppResource(
			"/api/mcp/resource",
			"ui://w/a.html",
			fetchReturning(
				Response.json({
					uri: "ui://w/a.html",
					html: "<p>w</p>",
					meta: { csp: { connectDomains: ["https://api.example.com"] } },
				}),
			),
		);
		expect(resource.meta).toEqual({
			csp: { connectDomains: ["https://api.example.com"] },
		});
		expect(resource.html).toBe("<p>w</p>");
	});

	test("fails on an error status", async () => {
		await expect(
			fetchMcpAppResource(
				"/api/mcp/resource",
				"ui://w/a.html",
				fetchReturning(
					Response.json({ error: "RESOURCE_NOT_FOUND" }, { status: 404 }),
				),
			),
		).rejects.toThrow("HTTP 404");
	});
});
