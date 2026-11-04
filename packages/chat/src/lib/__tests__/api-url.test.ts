import { describe, expect, test } from "bun:test";
import { buildApiUrl, platformEndpoint } from "../api-url";

describe("buildApiUrl", () => {
	test("appends a sibling path to a clean base", () => {
		expect(buildApiUrl("https://app.waniwani.ai/api/mcp/chat", "/config")).toBe(
			"https://app.waniwani.ai/api/mcp/chat/config",
		);
	});

	test("strips a trailing slash before appending", () => {
		expect(buildApiUrl("https://app.waniwani.ai/api/mcp/chat/", "/tools")).toBe(
			"https://app.waniwani.ai/api/mcp/chat/tools",
		);
	});

	test("merges params into a base with no query", () => {
		expect(
			buildApiUrl("https://app.waniwani.ai/api/mcp/chat", "/config", {
				channel: "abc 123",
			}),
		).toBe("https://app.waniwani.ai/api/mcp/chat/config?channel=abc+123");
	});

	test("inserts the path before an existing query and preserves it", () => {
		// Regression: internal surfaces append `?test=1` to the base. Naive
		// concatenation produced `.../chat?test=1/config`, a broken URL.
		expect(
			buildApiUrl("https://dev.waniwani.ai/api/mcp/chat?test=1", "/config", {
				channel: "1558de0b",
			}),
		).toBe(
			"https://dev.waniwani.ai/api/mcp/chat/config?test=1&channel=1558de0b",
		);
	});

	test("preserves the base query when no extra params are given", () => {
		expect(
			buildApiUrl("https://dev.waniwani.ai/api/mcp/chat?test=1", "/tools"),
		).toBe("https://dev.waniwani.ai/api/mcp/chat/tools?test=1");
	});

	test("works with a root-relative base", () => {
		expect(buildApiUrl("/api/waniwani", "/config")).toBe(
			"/api/waniwani/config",
		);
	});

	test("keeps the cancel route under a customer runtime's own mount", () => {
		expect(buildApiUrl("https://acme.example/agent/v1/chat", "/cancel")).toBe(
			"https://acme.example/agent/v1/chat/cancel",
		);
	});
});

describe("platformEndpoint", () => {
	test("swaps the whole path for a platform route on the same origin", () => {
		expect(
			platformEndpoint(
				"https://app.waniwani.ai/api/mcp/chat",
				"/api/mcp/events/v2/batch",
			),
		).toBe("https://app.waniwani.ai/api/mcp/events/v2/batch");
	});

	test("honours a self-hosted platform origin", () => {
		expect(
			platformEndpoint(
				"https://eu.app.waniwani.ai/api/mcp/chat",
				"/api/mcp/events/v2/batch",
			),
		).toBe("https://eu.app.waniwani.ai/api/mcp/events/v2/batch");
	});

	test("ignores the base's query string", () => {
		expect(
			platformEndpoint(
				"https://dev.waniwani.ai/api/mcp/chat?test=1",
				"/api/mcp/events/v2/batch",
			),
		).toBe("https://dev.waniwani.ai/api/mcp/events/v2/batch");
	});

	test("a root-relative platform base yields a root-relative route", () => {
		expect(platformEndpoint("/api/mcp/chat", "/api/mcp/events/v2/batch")).toBe(
			"/api/mcp/events/v2/batch",
		);
	});

	test("null for a customer runtime, which serves no platform route", () => {
		expect(
			platformEndpoint(
				"https://acme.example/agent/v1/chat",
				"/api/mcp/events/v2/batch",
			),
		).toBeNull();
	});

	test("null for a bring-your-own base off the platform mount", () => {
		for (const api of ["/api/waniwani", "/chat", "/api/agent/messages"]) {
			expect(platformEndpoint(api, "/api/mcp/events/v2/batch")).toBeNull();
		}
	});

	test("null for anything it cannot read as a url or a path", () => {
		for (const api of ["", "   ", "not a url", "://nope"]) {
			expect(platformEndpoint(api, "/api/mcp/events/v2/batch")).toBeNull();
		}
	});
});
