import { describe, expect, test } from "bun:test";
import { extractTransportSessionId } from "../transport-session.js";

describe("extractTransportSessionId", () => {
	test("returns extra.sessionId when present", () => {
		expect(extractTransportSessionId({ sessionId: "sid-from-transport" })).toBe(
			"sid-from-transport",
		);
	});

	test("returns mcp-session-id from requestInfo headers", () => {
		expect(
			extractTransportSessionId({
				requestInfo: {
					headers: { "mcp-session-id": "sid-from-header" },
				},
			}),
		).toBe("sid-from-header");
	});

	test("prefers extra.sessionId over requestInfo header", () => {
		expect(
			extractTransportSessionId({
				sessionId: "sid-from-transport",
				requestInfo: {
					headers: { "mcp-session-id": "sid-from-header" },
				},
			}),
		).toBe("sid-from-transport");
	});

	test("returns undefined when neither is present", () => {
		expect(extractTransportSessionId({})).toBe(undefined);
	});

	test("ignores empty string sessionId", () => {
		expect(extractTransportSessionId({ sessionId: "" })).toBe(undefined);
	});

	test("ignores non-string sessionId", () => {
		expect(extractTransportSessionId({ sessionId: 42 })).toBe(undefined);
	});

	test("ignores malformed requestInfo", () => {
		expect(extractTransportSessionId({ requestInfo: "not-an-object" })).toBe(
			undefined,
		);
		expect(extractTransportSessionId({ requestInfo: { headers: null } })).toBe(
			undefined,
		);
	});
});
