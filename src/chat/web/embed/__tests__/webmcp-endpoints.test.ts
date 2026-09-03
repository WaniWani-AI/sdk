import { describe, expect, test } from "bun:test";
import { resolveWebMcpEndpoints } from "../webmcp-endpoints";

const API = "https://app.waniwani.ai/api/mcp/chat";
const TOKEN = "wwp_abc123";

describe("resolveWebMcpEndpoints", () => {
	// The whole point of routing through the hosted API: the token identifies
	// the environment, so nothing about the MCP server appears on the page.
	test("derives both endpoints from the token alone", () => {
		const resolved = resolveWebMcpEndpoints({ api: API, token: TOKEN });
		expect(resolved).toEqual({
			toolsEndpoint: `${API}/webmcp`,
			resourceEndpoint: `${API}/resource?token=${TOKEN}`,
			headers: { Authorization: `Bearer ${TOKEN}` },
		});
	});

	// A POST can carry a header; an iframe GET cannot, so only the resource URL
	// spends the token in the query string.
	test("authenticates the POST by header and the iframe by query", () => {
		const resolved = resolveWebMcpEndpoints({ api: API, token: TOKEN });
		expect(resolved?.toolsEndpoint).not.toContain(TOKEN);
		expect(resolved?.headers.Authorization).toBe(`Bearer ${TOKEN}`);
		expect(resolved?.resourceEndpoint).toContain(`token=${TOKEN}`);
	});

	describe("switches", () => {
		test("an unknown channel switch reads as on", () => {
			expect(
				resolveWebMcpEndpoints({ api: API, token: TOKEN }, undefined),
			).not.toBeNull();
			expect(
				resolveWebMcpEndpoints({ api: API, token: TOKEN }, true),
			).not.toBeNull();
		});

		// The page's is markup intent; the channel's is the dashboard kill switch,
		// which has to work without the site being touched.
		test("either one closes it", () => {
			expect(
				resolveWebMcpEndpoints({
					api: API,
					token: TOKEN,
					webmcp: { enabled: false },
				}),
			).toBeNull();
			expect(
				resolveWebMcpEndpoints({ api: API, token: TOKEN }, false),
			).toBeNull();
		});
	});

	test("is on with no webmcp config at all", () => {
		expect(resolveWebMcpEndpoints({ api: API, token: TOKEN })).not.toBeNull();
	});

	test("the page's switch closes it", () => {
		expect(
			resolveWebMcpEndpoints({
				api: API,
				token: TOKEN,
				webmcp: { enabled: false },
			}),
		).toBeNull();
	});

	// The token is the whole configuration. Without it there is no environment
	// to resolve and nothing to point at.
	test("no token means nothing to point at", () => {
		expect(resolveWebMcpEndpoints({ api: API })).toBeNull();
	});

	describe("channelId", () => {
		// Ingest drops what it cannot attribute, so a call with no channel is a
		// conversion nobody sees.
		test("takes the author-set channel", () => {
			expect(
				resolveWebMcpEndpoints({ api: API, token: TOKEN, channelId: "ch-1" })
					?.channelId,
			).toBe("ch-1");
		});

		test("falls back to the one the server resolved from the token", () => {
			expect(
				resolveWebMcpEndpoints({ api: API, token: TOKEN }, undefined, "ch-2")
					?.channelId,
			).toBe("ch-2");
		});

		test("author-set wins", () => {
			expect(
				resolveWebMcpEndpoints(
					{ api: API, token: TOKEN, channelId: "ch-1" },
					undefined,
					"ch-2",
				)?.channelId,
			).toBe("ch-1");
		});

		// A first visit has no cached config yet, and publishing tools beats
		// waiting for a round trip to learn a channel the server can infer.
		test("is absent when neither knows one", () => {
			expect(
				resolveWebMcpEndpoints({ api: API, token: TOKEN }),
			).not.toHaveProperty("channelId");
		});
	});

	describe("mcpServerUrl", () => {
		// It is the chat's override for which MCP server the *server* talks to,
		// not an instruction to bypass it. Forwarded so both surfaces land on the
		// same server, and gated where the app already gates it.
		test("rides along as a query param rather than redirecting the page", () => {
			const resolved = resolveWebMcpEndpoints({
				api: API,
				token: TOKEN,
				mcpServerUrl: "https://staging.mcp.example/mcp",
			});
			expect(resolved?.toolsEndpoint).toBe(
				`${API}/webmcp?mcpServerUrl=${encodeURIComponent("https://staging.mcp.example/mcp")}`,
			);
			expect(resolved?.resourceEndpoint).toContain("mcpServerUrl=");
			expect(resolved?.resourceEndpoint).toContain(`token=${TOKEN}`);
		});

		test("is absent from the urls when unset", () => {
			const resolved = resolveWebMcpEndpoints({ api: API, token: TOKEN });
			expect(resolved?.toolsEndpoint).not.toContain("mcpServerUrl");
			expect(resolved?.resourceEndpoint).not.toContain("mcpServerUrl");
		});
	});

	// `buildApiUrl` exists because internal surfaces append markers to the base.
	test("preserves query params already on the api base", () => {
		const resolved = resolveWebMcpEndpoints({
			api: `${API}?test=1`,
			token: TOKEN,
		});
		expect(resolved?.toolsEndpoint).toBe(`${API}/webmcp?test=1`);
		expect(resolved?.resourceEndpoint).toContain("test=1");
	});
});
