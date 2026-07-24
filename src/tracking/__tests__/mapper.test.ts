import { describe, expect, test } from "bun:test";
import type { LegacyTrackEvent } from "../@types.js";
import { mapTrackEventToV2 } from "../mapper.js";

describe("mapTrackEventToV2", () => {
	test("maps legacy eventType input and preserves raw legacy payload", () => {
		const legacyEvent: LegacyTrackEvent = {
			eventType: "tool.called",
			sessionId: "session-explicit",
			toolName: "pricing",
			toolType: "pricing",
			metadata: { from: "legacy" },
			meta: { requestId: "request-from-meta" },
		};

		const mapped = mapTrackEventToV2(legacyEvent, {
			now: () => new Date("2026-02-26T00:00:00.000Z"),
			generateId: () => "evt_fixed",
		});

		expect(mapped.id).toBe("evt_fixed");
		expect(mapped.type).toBe("mcp.event");
		expect(mapped.name).toBe("tool.called");
		expect(mapped.timestamp).toBe("2026-02-26T00:00:00.000Z");
		expect(mapped.correlation.sessionId).toBe("session-explicit");
		expect(mapped.correlation.requestId).toBe("request-from-meta");
		expect(mapped.properties).toEqual({ name: "pricing", type: "pricing" });
		expect(mapped.metadata).toMatchObject({ from: "legacy" });
		expect(mapped.metadata.rawLegacy).toBeDefined();
		expect(mapped.rawLegacy?.eventType).toBe("tool.called");
	});

	test("merges legacy-mapped fields with explicit properties", () => {
		const mapped = mapTrackEventToV2({
			eventType: "tool.called",
			toolName: "pricing",
			toolType: "pricing",
			properties: { source: "calculator", name: "override" },
		});

		expect(mapped.name).toBe("tool.called");
		expect(mapped.properties).toEqual({
			name: "override",
			type: "pricing",
			source: "calculator",
		});
	});

	test("extracts sessionId from waniwani/sessionId in meta", () => {
		const mapped = mapTrackEventToV2({
			event: "user.identified",
			meta: {
				"waniwani/sessionId": "c9c1540c-6eee-4303-9f64-b184b592fd1b",
			},
		});

		expect(mapped.correlation.sessionId).toBe(
			"c9c1540c-6eee-4303-9f64-b184b592fd1b",
		);
	});

	test("waniwani/sessionId takes precedence over openai/sessionId", () => {
		const mapped = mapTrackEventToV2({
			event: "tool.called",
			meta: {
				"waniwani/sessionId": "waniwani-session",
				"openai/sessionId": "openai-session",
			},
		});

		expect(mapped.correlation.sessionId).toBe("waniwani-session");
	});

	test("uses metadata fallback precedence for session and trace ids", () => {
		const mapped = mapTrackEventToV2({
			event: "session.started",
			meta: {
				"openai/sessionId": "session-openai",
				sessionId: "session-meta",
				conversationId: "session-conversation",
				"openai/traceId": "trace-openai",
				traceId: "trace-meta",
			},
		});

		expect(mapped.correlation.sessionId).toBe("session-openai");
		expect(mapped.correlation.traceId).toBe("trace-openai");
	});

	test("keeps explicit correlation fields over metadata fallback", () => {
		const mapped = mapTrackEventToV2({
			event: "link.clicked",
			sessionId: "session-explicit",
			traceId: "trace-explicit",
			requestId: "request-explicit",
			correlationId: "corr-explicit",
			externalUserId: "user-explicit",
			meta: {
				"openai/sessionId": "session-meta",
				"openai/traceId": "trace-meta",
				requestId: "request-meta",
				externalUserId: "user-meta",
			},
		});

		expect(mapped.correlation).toEqual({
			sessionId: "session-explicit",
			traceId: "trace-explicit",
			requestId: "request-explicit",
			correlationId: "corr-explicit",
			externalUserId: "user-explicit",
		});
	});

	test("assigns deterministic id/timestamp/source when injected", () => {
		const mapped = mapTrackEventToV2(
			{ event: "session.started" },
			{
				now: () => new Date("2026-02-26T03:04:05.000Z"),
				generateId: () => "evt_test_deterministic",
				source: "test-source",
			},
		);

		expect(mapped.id).toBe("evt_test_deterministic");
		expect(mapped.timestamp).toBe("2026-02-26T03:04:05.000Z");
		expect(mapped.source).toBe("test-source");
	});
});
