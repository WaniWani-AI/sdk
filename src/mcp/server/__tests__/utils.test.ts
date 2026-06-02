import { describe, expect, it } from "bun:test";
import { extractSource, extractSourceFromHeaders } from "../utils";

describe("extractSource", () => {
	it("returns undefined for missing meta", () => {
		expect(extractSource(undefined)).toBeUndefined();
		expect(extractSource({})).toBeUndefined();
	});

	it("returns the explicit waniwani/source when set", () => {
		expect(extractSource({ "waniwani/source": "playground" })).toBe(
			"playground",
		);
	});

	it("explicit waniwani/source wins over any session-derived source", () => {
		expect(
			extractSource({
				"waniwani/source": "playground",
				"openai/sessionId": "v1/abc",
			}),
		).toBe("playground");
	});

	it("derives chatgpt from openai/sessionId", () => {
		expect(extractSource({ "openai/sessionId": "v1/abc" })).toBe("chatgpt");
	});

	it("derives chatgpt from openai/session", () => {
		expect(extractSource({ "openai/session": "v1/abc" })).toBe("chatgpt");
	});

	// Regression: WAN-374 — when both `waniwani/sessionId` and `openai/*` are
	// present (ChatGPT session whose meta was enriched with the same id under
	// both keys, or whose transport propagated `mcp-session-id` separately),
	// the source must be "chatgpt", not "chatbar".
	it("prefers openai keys over waniwani/sessionId when both are present", () => {
		expect(
			extractSource({
				"waniwani/sessionId": "v1/abc",
				"openai/sessionId": "v1/abc",
			}),
		).toBe("chatgpt");

		expect(
			extractSource({
				"waniwani/sessionId": "v1/abc",
				"openai/session": "v1/abc",
			}),
		).toBe("chatgpt");
	});

	// Regression: WAN-374 — `waniwani/sessionId` alone is a correlation ID,
	// not an implicit "chatbar" signal. Callers that genuinely come from the
	// chatbar opt in via `waniwani/source`.
	it("does not derive a source from waniwani/sessionId alone", () => {
		expect(extractSource({ "waniwani/sessionId": "ses-1" })).toBeUndefined();
	});

	it("derives chatbar only when waniwani/source is explicitly set", () => {
		expect(
			extractSource({
				"waniwani/source": "chatbar",
				"waniwani/sessionId": "ses-1",
			}),
		).toBe("chatbar");
	});

	it("ignores non-string source values", () => {
		expect(
			extractSource({
				"waniwani/source": 42,
				"openai/sessionId": "v1/abc",
			} as Record<string, unknown>),
		).toBe("chatgpt");
	});

	it("ignores empty-string source and session values", () => {
		expect(
			extractSource({
				"waniwani/source": "",
				"openai/sessionId": "",
			}),
		).toBeUndefined();
	});

	// Claude surfaces don't expose a namespaced session id in _meta but do
	// advertise themselves via clientInfo.name in the MCP `initialize`
	// handshake. Match is case-insensitive substring so "Claude",
	// "Claude Code", "claude-ai", etc. all resolve to "claude".
	describe("clientInfo fallback", () => {
		it("derives claude from clientInfo.name when _meta has no source key", () => {
			expect(extractSource({}, { name: "Claude Code" })).toBe("claude");
			expect(extractSource(undefined, { name: "Claude" })).toBe("claude");
			expect(extractSource({}, { name: "claude-ai" })).toBe("claude");
			expect(extractSource({}, { name: "CLAUDE" })).toBe("claude");
		});

		it("returns undefined for unknown clientInfo.name", () => {
			expect(extractSource({}, { name: "some-other-client" })).toBeUndefined();
			expect(extractSource({}, { name: "" })).toBeUndefined();
			expect(extractSource({}, {})).toBeUndefined();
		});

		it("_meta source keys win over clientInfo.name", () => {
			expect(
				extractSource({ "openai/sessionId": "v1/abc" }, { name: "Claude" }),
			).toBe("chatgpt");
			expect(
				extractSource({ "waniwani/source": "playground" }, { name: "Claude" }),
			).toBe("playground");
		});
	});
});

describe("extractSourceFromHeaders", () => {
	it("returns undefined for missing headers", () => {
		expect(extractSourceFromHeaders(undefined)).toBeUndefined();
		expect(extractSourceFromHeaders({})).toBeUndefined();
	});

	// Claude HTTP requests carry these signals when neither _meta nor
	// clientInfo resolves (e.g. stateless deployments). This mirrors
	// skybridge's own `user-agent === "Claude-User"` check.
	it("derives claude from the Claude-User user-agent", () => {
		expect(extractSourceFromHeaders({ "user-agent": "Claude-User" })).toBe(
			"claude",
		);
	});

	it("derives claude from the x-anthropic-client header", () => {
		expect(extractSourceFromHeaders({ "x-anthropic-client": "ClaudeAI" })).toBe(
			"claude",
		);
	});

	it("matches case-insensitively and normalizes header casing", () => {
		expect(extractSourceFromHeaders({ "User-Agent": "claude-user/1.0" })).toBe(
			"claude",
		);
	});

	it("handles array-valued headers", () => {
		expect(extractSourceFromHeaders({ "user-agent": ["Claude-User"] })).toBe(
			"claude",
		);
	});

	it("returns undefined for non-Claude user agents", () => {
		expect(
			extractSourceFromHeaders({ "user-agent": "Mozilla/5.0" }),
		).toBeUndefined();
		expect(extractSourceFromHeaders({ "user-agent": "" })).toBeUndefined();
	});
});
