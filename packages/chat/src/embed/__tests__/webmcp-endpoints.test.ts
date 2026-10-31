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
			listEndpoint:
				"https://app.waniwani.ai/api/mcp/chat/webmcp/tools?token=wwp_abc123",
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

function splitUrl(url: string | undefined) {
	const parsed = new URL(url ?? "", "https://page.invalid");
	return {
		path: `${parsed.origin}${parsed.pathname}`,
		params: [...parsed.searchParams.entries()].sort(([a], [b]) =>
			a.localeCompare(b),
		),
	};
}

describe("resolveWebMcpEndpoints listEndpoint", () => {
	test("is the tools path with the token and nothing else in the query", () => {
		expect(
			resolveWebMcpEndpoints({ api: API, token: TOKEN })?.listEndpoint,
		).toBe(
			"https://app.waniwani.ai/api/mcp/chat/webmcp/tools?token=wwp_abc123",
		);
	});

	test("names the author-set channel", () => {
		const resolved = resolveWebMcpEndpoints({
			api: API,
			token: TOKEN,
			channelId: "ch_1",
		});
		expect(splitUrl(resolved?.listEndpoint)).toEqual({
			path: "https://app.waniwani.ai/api/mcp/chat/webmcp/tools",
			params: [
				["channel", "ch_1"],
				["token", "wwp_abc123"],
			],
		});
	});

	test("names the channel the server resolved when the markup names none", () => {
		const resolved = resolveWebMcpEndpoints(
			{ api: API, token: TOKEN },
			undefined,
			"ch_2",
		);
		expect(splitUrl(resolved?.listEndpoint).params).toEqual([
			["channel", "ch_2"],
			["token", "wwp_abc123"],
		]);
	});

	test("the author-set channel wins over the resolved one", () => {
		const resolved = resolveWebMcpEndpoints(
			{ api: API, token: TOKEN, channelId: "ch_1" },
			true,
			"ch_2",
		);
		expect(splitUrl(resolved?.listEndpoint).params).toEqual([
			["channel", "ch_1"],
			["token", "wwp_abc123"],
		]);
		expect(resolved?.listEndpoint).not.toContain("ch_2");
	});

	test("leaves the channel out entirely when neither side knows one", () => {
		const listEndpoint = resolveWebMcpEndpoints(
			{ api: API, token: TOKEN },
			undefined,
			undefined,
		)?.listEndpoint;
		expect(listEndpoint).not.toContain("channel");
	});

	test("an empty resolved channel is no channel", () => {
		const resolved = resolveWebMcpEndpoints(
			{ api: API, token: TOKEN },
			undefined,
			"",
		);
		expect(resolved?.listEndpoint).toBe(
			"https://app.waniwani.ai/api/mcp/chat/webmcp/tools?token=wwp_abc123",
		);
		expect(resolved).not.toHaveProperty("channelId");
	});

	// Calls are attributed by `channelId` and the listing by `channel`; a page
	// whose two disagree lists one channel's tools and bills another.
	test("an empty author channel never yields an empty param, and the listing agrees with calls", () => {
		const resolved = resolveWebMcpEndpoints(
			{ api: API, token: TOKEN, channelId: "" },
			undefined,
			"ch_2",
		);
		const channelParam = new URL(resolved?.listEndpoint ?? "").searchParams.get(
			"channel",
		);
		expect(channelParam).not.toBe("");
		expect(channelParam ?? undefined).toBe(resolved?.channelId);
	});

	test("carries mcpServerUrl beside the token when it is set", () => {
		const resolved = resolveWebMcpEndpoints({
			api: API,
			token: TOKEN,
			mcpServerUrl: "https://staging.mcp.example/mcp",
		});
		expect(splitUrl(resolved?.listEndpoint)).toEqual({
			path: "https://app.waniwani.ai/api/mcp/chat/webmcp/tools",
			params: [
				["mcpServerUrl", "https://staging.mcp.example/mcp"],
				["token", "wwp_abc123"],
			],
		});
		expect(resolved?.listEndpoint).toContain(
			"mcpServerUrl=https%3A%2F%2Fstaging.mcp.example%2Fmcp",
		);
	});

	test("an empty mcpServerUrl is treated as unset", () => {
		const resolved = resolveWebMcpEndpoints({
			api: API,
			token: TOKEN,
			mcpServerUrl: "",
		});
		expect(resolved?.listEndpoint).toBe(
			"https://app.waniwani.ai/api/mcp/chat/webmcp/tools?token=wwp_abc123",
		);
	});

	test("keeps a query string already on the api base, once, beside every param", () => {
		const resolved = resolveWebMcpEndpoints(
			{
				api: `${API}?test=1`,
				token: TOKEN,
				mcpServerUrl: "https://staging.mcp.example/mcp",
			},
			undefined,
			"ch_2",
		);
		expect(splitUrl(resolved?.listEndpoint)).toEqual({
			path: "https://app.waniwani.ai/api/mcp/chat/webmcp/tools",
			params: [
				["channel", "ch_2"],
				["mcpServerUrl", "https://staging.mcp.example/mcp"],
				["test", "1"],
				["token", "wwp_abc123"],
			],
		});
	});

	test("drops a trailing slash on the api base", () => {
		expect(
			resolveWebMcpEndpoints({ api: `${API}/`, token: TOKEN })?.listEndpoint,
		).toBe(
			"https://app.waniwani.ai/api/mcp/chat/webmcp/tools?token=wwp_abc123",
		);
	});

	test("stays root-relative when the api base is", () => {
		expect(
			resolveWebMcpEndpoints({ api: "/api/mcp/chat", token: TOKEN })
				?.listEndpoint,
		).toBe("/api/mcp/chat/webmcp/tools?token=wwp_abc123");
	});

	test("encodes a token and channel carrying URL syntax so they read back intact", () => {
		const resolved = resolveWebMcpEndpoints(
			{ api: API, token: "wwp_a+b/c=&d" },
			undefined,
			"ch 1&x=y",
		);
		const params = new URL(resolved?.listEndpoint ?? "").searchParams;
		expect(params.getAll("token")).toEqual(["wwp_a+b/c=&d"]);
		expect(params.getAll("channel")).toEqual(["ch 1&x=y"]);
		expect([...params.keys()].sort()).toEqual(["channel", "token"]);
	});

	describe("leaves the other endpoints as they were", () => {
		test("the POST target gains no token and no channel", () => {
			const resolved = resolveWebMcpEndpoints(
				{ api: API, token: TOKEN, channelId: "ch_1" },
				undefined,
				"ch_2",
			);
			expect(resolved?.toolsEndpoint).toBe(
				"https://app.waniwani.ai/api/mcp/chat/webmcp",
			);
			expect(resolved?.resourceEndpoint).toBe(
				"https://app.waniwani.ai/api/mcp/chat/resource?token=wwp_abc123",
			);
			expect(resolved?.headers).toEqual({
				Authorization: "Bearer wwp_abc123",
			});
			expect(resolved?.channelId).toBe("ch_1");
		});
	});

	describe("still resolves to nothing", () => {
		test("with an empty token", () => {
			expect(resolveWebMcpEndpoints({ api: API, token: "" })).toBeNull();
		});

		test("when the page switch is off, whatever channel is known", () => {
			expect(
				resolveWebMcpEndpoints(
					{
						api: API,
						token: TOKEN,
						channelId: "ch_1",
						webmcp: { enabled: false },
					},
					true,
					"ch_2",
				),
			).toBeNull();
		});

		test("when the channel switch is off, whatever channel is known", () => {
			expect(
				resolveWebMcpEndpoints(
					{ api: API, token: TOKEN, channelId: "ch_1" },
					false,
					"ch_2",
				),
			).toBeNull();
		});
	});
});
