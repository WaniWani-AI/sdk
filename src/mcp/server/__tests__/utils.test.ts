import { describe, expect, it } from "bun:test";
import { extractSource } from "../utils";

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
});
