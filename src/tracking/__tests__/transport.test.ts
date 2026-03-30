import { describe, expect, test } from "bun:test";
import { createV2BatchTransport } from "../transport.js";
import type { V2BatchRequest, V2EventEnvelope } from "../v2-types.js";
import { delay, waitFor } from "./test-helpers.js";

function makeEvent(id: string): V2EventEnvelope {
	return {
		id,
		type: "mcp.event",
		name: "tool.called",
		source: "test",
		timestamp: "2026-02-26T00:00:00.000Z",
		correlation: {},
		properties: {},
		metadata: {},
	};
}

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

describe("V2 transport", () => {
	test("flushes periodically", async () => {
		const requests: V2BatchRequest[] = [];

		const transport = createV2BatchTransport({
			apiUrl: "https://example.com",
			apiKey: "test-key",
			flushIntervalMs: 20,
			maxBatchSize: 50,
			fetchFn: async (_url, init) => {
				requests.push(JSON.parse(String(init?.body)));
				return jsonResponse({ accepted: 1 });
			},
		});

		transport.enqueue(makeEvent("evt_1"));
		await waitFor(() => requests.length === 1, { timeoutMs: 500 });
		expect(requests[0]?.events).toHaveLength(1);

		await transport.shutdown();
	});

	test("flushes immediately at batch threshold", async () => {
		const requests: V2BatchRequest[] = [];

		const transport = createV2BatchTransport({
			apiUrl: "https://example.com",
			apiKey: "test-key",
			flushIntervalMs: 10_000,
			maxBatchSize: 2,
			fetchFn: async (_url, init) => {
				requests.push(JSON.parse(String(init?.body)));
				return jsonResponse({ accepted: 2 });
			},
		});

		transport.enqueue(makeEvent("evt_1"));
		transport.enqueue(makeEvent("evt_2"));

		await waitFor(() => requests.length === 1, { timeoutMs: 500 });
		expect(requests[0]?.events).toHaveLength(2);

		await transport.shutdown();
	});

	test("retries transient failures with backoff", async () => {
		let attempts = 0;
		const backoffs: number[] = [];

		const transport = createV2BatchTransport({
			apiUrl: "https://example.com",
			apiKey: "test-key",
			flushIntervalMs: 10_000,
			maxRetries: 2,
			retryBaseDelayMs: 5,
			sleep: async (ms) => {
				backoffs.push(ms);
				await delay(1);
			},
			fetchFn: async () => {
				attempts += 1;
				if (attempts === 1) {
					return new Response("temporary", { status: 503 });
				}
				return jsonResponse({ accepted: 1 });
			},
		});

		transport.enqueue(makeEvent("evt_retry"));
		await transport.flush();

		expect(attempts).toBe(2);
		expect(backoffs).toEqual([5]);

		await transport.shutdown();
	});

	test("stops permanently after auth failure", async () => {
		let attempts = 0;

		const transport = createV2BatchTransport({
			apiUrl: "https://example.com",
			apiKey: "test-key",
			flushIntervalMs: 10_000,
			fetchFn: async () => {
				attempts += 1;
				if (attempts === 1) {
					return new Response("unauthorized", { status: 401 });
				}
				return jsonResponse({ accepted: 1 });
			},
		});

		transport.enqueue(makeEvent("evt_auth_1"));
		await transport.flush();

		transport.enqueue(makeEvent("evt_auth_2"));
		await transport.flush();

		expect(attempts).toBe(1);
		await transport.shutdown();
	});

	test("drains on shutdown and reports timeout state", async () => {
		const fastTransport = createV2BatchTransport({
			apiUrl: "https://example.com",
			apiKey: "test-key",
			flushIntervalMs: 10_000,
			fetchFn: async () => {
				await delay(20);
				return jsonResponse({ accepted: 1 });
			},
		});

		fastTransport.enqueue(makeEvent("evt_shutdown_ok"));
		const drained = await fastTransport.shutdown({ timeoutMs: 200 });
		expect(drained.timedOut).toBe(false);
		expect(drained.pendingEvents).toBe(0);

		const slowTransport = createV2BatchTransport({
			apiUrl: "https://example.com",
			apiKey: "test-key",
			flushIntervalMs: 10_000,
			fetchFn: async () => {
				await delay(100);
				return jsonResponse({ accepted: 1 });
			},
		});

		slowTransport.enqueue(makeEvent("evt_shutdown_timeout"));
		const timedOut = await slowTransport.shutdown({ timeoutMs: 10 });
		expect(timedOut.timedOut).toBe(true);
		expect(timedOut.pendingEvents).toBeGreaterThan(0);
	});
});
