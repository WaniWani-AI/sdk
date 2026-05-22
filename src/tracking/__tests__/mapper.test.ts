import { describe, expect, test } from "bun:test";
import type { LegacyTrackEvent } from "../@types.js";
import { mapTrackEventToV2 } from "../mapper.js";

describe("mapTrackEventToV2", () => {
	test("maps legacy eventType input into V2 envelope", () => {
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
		expect(mapped.metadata).not.toHaveProperty("rawLegacy");
		expect(mapped).not.toHaveProperty("rawLegacy");
		// Belt-and-suspenders: catch any reintroduction of rawLegacy via nested
		// spreading (e.g. inside metadata.meta) that the top-level assertions miss.
		expect(JSON.stringify(mapped)).not.toContain("rawLegacy");
	});

	test("maps docs-style quote fields and merges with explicit properties", () => {
		const mapped = mapTrackEventToV2({
			eventType: "quote.succeeded",
			quoteAmount: 120,
			quoteCurrency: "USD",
			properties: { source: "calculator", amount: 140 },
		});

		expect(mapped.name).toBe("quote.succeeded");
		expect(mapped.properties).toEqual({
			amount: 140,
			currency: "USD",
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
			event: "quote.requested",
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
			{ event: "quote.failed" },
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
