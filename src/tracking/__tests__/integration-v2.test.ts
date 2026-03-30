import { describe, expect, test } from "bun:test";
import { once } from "node:events";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { waniwani } from "../../waniwani.js";
import type { V2BatchRequest } from "../v2-types.js";

type CapturedRequest = {
	path: string;
	headers: Record<string, string | string[] | undefined>;
	body: V2BatchRequest;
};

describe("integration: SDK to V2 ingest", () => {
	test("sends V2 batch envelope and mapped canonical fields", async () => {
		const captured: CapturedRequest[] = [];
		const server = createServer(async (req, res) => {
			const body = (await readJson(req)) as V2BatchRequest;
			captured.push({
				path: req.url ?? "",
				headers: req.headers,
				body,
			});
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ accepted: body.events.length }));
		});

		server.listen(0, "127.0.0.1");
		await once(server, "listening");
		const address = server.address() as AddressInfo;
		const apiUrl = `http://127.0.0.1:${address.port}`;

		const client = waniwani({
			apiKey: "test-key",
			apiUrl,
			tracking: {
				flushIntervalMs: 10_000,
				maxBatchSize: 10,
			},
		});

		const first = await client.track({
			eventType: "tool.called",
			toolName: "pricing",
			toolType: "pricing",
			meta: { "openai/sessionId": "session-1", requestId: "request-1" },
		});
		const second = await client.track({
			event: "quote.succeeded",
			properties: { amount: 120, currency: "USD" },
		});

		await client.flush();

		expect(first.eventId).toStartWith("evt_");
		expect(second.eventId).toStartWith("evt_");
		expect(captured).toHaveLength(1);
		expect(captured[0]?.path).toBe("/api/mcp/events/v2/batch");
		expect(captured[0]?.headers.authorization).toBe("Bearer test-key");
		expect(captured[0]?.body.events).toHaveLength(2);

		const [eventOne, eventTwo] = captured[0]?.body.events ?? [];
		expect(eventOne?.type).toBe("mcp.event");
		expect(eventOne?.name).toBe("tool.called");
		expect(eventOne?.properties).toEqual({ name: "pricing", type: "pricing" });
		expect(eventOne?.correlation.sessionId).toBe("session-1");
		expect(eventOne?.correlation.requestId).toBe("request-1");

		expect(eventTwo?.name).toBe("quote.succeeded");
		expect(eventTwo?.properties).toEqual({ amount: 120, currency: "USD" });

		await client.shutdown();
		server.close();
		await once(server, "close");
	});

	test("handles transient and partial retryable responses", async () => {
		let callCount = 0;
		const capturedBodies: V2BatchRequest[] = [];
		const server = createServer(async (req, res) => {
			const body = (await readJson(req)) as V2BatchRequest;
			capturedBodies.push(body);
			callCount += 1;

			if (callCount === 1) {
				res.writeHead(503, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ error: "temporary" }));
				return;
			}

			if (callCount === 2) {
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(
					JSON.stringify({
						accepted: 0,
						rejected: body.events.map((event) => ({
							eventId: event.id,
							code: "temporary_unavailable",
							retryable: true,
						})),
					}),
				);
				return;
			}

			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ accepted: body.events.length }));
		});

		server.listen(0, "127.0.0.1");
		await once(server, "listening");
		const address = server.address() as AddressInfo;
		const apiUrl = `http://127.0.0.1:${address.port}`;

		const client = waniwani({
			apiKey: "test-key",
			apiUrl,
			tracking: {
				flushIntervalMs: 10_000,
				maxRetries: 3,
				retryBaseDelayMs: 5,
				retryMaxDelayMs: 20,
			},
		});

		await client.track({ event: "quote.requested" });
		await client.flush();

		expect(callCount).toBe(3);
		expect(capturedBodies.length).toBeGreaterThanOrEqual(3);

		await client.shutdown();
		server.close();
		await once(server, "close");
	});
});

async function readJson(req: IncomingMessage): Promise<unknown> {
	const chunks: Buffer[] = [];

	for await (const chunk of req) {
		if (typeof chunk === "string") {
			chunks.push(Buffer.from(chunk));
			continue;
		}
		chunks.push(chunk as Buffer);
	}

	const raw = Buffer.concat(chunks).toString("utf8");
	if (!raw) {
		return {};
	}
	return JSON.parse(raw);
}
