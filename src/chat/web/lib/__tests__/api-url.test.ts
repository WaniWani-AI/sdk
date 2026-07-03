import { describe, expect, test } from "bun:test";
import { buildApiUrl } from "../api-url";

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
});
