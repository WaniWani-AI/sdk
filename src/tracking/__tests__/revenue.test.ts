import { describe, expect, test } from "bun:test";
import { once } from "node:events";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { waniwani } from "../../waniwani.js";
import type { V2BatchRequest, V2EventEnvelope } from "../v2-types.js";

async function captureBatch(
	emit: (client: ReturnType<typeof waniwani>) => Promise<{ eventId: string }>,
): Promise<{ events: V2EventEnvelope[]; result: { eventId: string } }> {
	const captured: V2BatchRequest[] = [];
	const server = createServer(async (req, res) => {
		const body = (await readJson(req)) as V2BatchRequest;
		captured.push(body);
		res.writeHead(200, { "Content-Type": "application/json" });
		res.end(JSON.stringify({ accepted: body.events.length }));
	});

	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	const address = server.address() as AddressInfo;

	const client = waniwani({
		apiKey: "test-key",
		apiUrl: `http://127.0.0.1:${address.port}`,
		tracking: { flushIntervalMs: 10_000, maxBatchSize: 50 },
	});

	const result = await emit(client);
	await client.flush();
	await client.shutdown();
	server.close();
	await once(server, "close");

	return { events: captured.flatMap((batch) => batch.events), result };
}

describe("track.* revenue helpers", () => {
	test("track is callable and exposes the flat revenue helpers", () => {
		const client = waniwani({ apiKey: "test-key" });
		expect(typeof client.track).toBe("function");
		expect(typeof client.track.priceShown).toBe("function");
		expect(typeof client.track.converted).toBe("function");
	});

	test("priceShown maps to price_shown with typed properties + identity", async () => {
		const { events, result } = await captureBatch((c) =>
			c.track.priceShown({
				amount: 49,
				currency: "EUR",
				itemId: "plan_pro",
				label: "Pro monthly",
				externalUserId: "user@example.com",
			}),
		);

		expect(result.eventId).toStartWith("evt_");
		expect(events).toHaveLength(1);
		expect(events[0]?.name).toBe("price_shown");
		expect(events[0]?.properties).toEqual({
			amount: 49,
			currency: "EUR",
			itemId: "plan_pro",
			label: "Pro monthly",
		});
		expect(events[0]?.correlation.externalUserId).toBe("user@example.com");
	});

	test("pricesCompared carries the compared options and sessionId", async () => {
		const { events } = await captureBatch((c) =>
			c.track.pricesCompared({
				options: [
					{ id: "a", amount: 10, currency: "USD" },
					{ id: "b", amount: 20, currency: "USD" },
				],
				sessionId: "sess-1",
			}),
		);

		expect(events[0]?.name).toBe("prices_compared");
		expect(events[0]?.properties.options).toHaveLength(2);
		expect(events[0]?.correlation.sessionId).toBe("sess-1");
	});

	test("optionSelected maps the picked option", async () => {
		const { events } = await captureBatch((c) =>
			c.track.optionSelected({
				id: "b",
				amount: 20,
				currency: "USD",
				sessionId: "sess-1",
			}),
		);

		expect(events[0]?.name).toBe("option_selected");
		expect(events[0]?.properties).toEqual({
			id: "b",
			amount: 20,
			currency: "USD",
		});
	});

	test("leadQualified carries the source", async () => {
		const { events } = await captureBatch((c) =>
			c.track.leadQualified({
				source: "newsletter",
				externalUserId: "user@example.com",
			}),
		);

		expect(events[0]?.name).toBe("lead_qualified");
		expect(events[0]?.properties).toEqual({ source: "newsletter" });
		expect(events[0]?.correlation.externalUserId).toBe("user@example.com");
	});

	test("leadQualified carries externalId, email and name", async () => {
		const { events } = await captureBatch((c) =>
			c.track.leadQualified({
				externalId: "lead_abc123",
				email: "jane@example.com",
				name: "Jane Doe",
				sessionId: "sess_1",
			}),
		);

		expect(events[0]?.name).toBe("lead_qualified");
		expect(events[0]?.properties).toEqual({
			externalId: "lead_abc123",
			email: "jane@example.com",
			name: "Jane Doe",
		});
		expect(events[0]?.correlation.sessionId).toBe("sess_1");
	});

	test("deprecated track.lead alias emits lead_qualified", async () => {
		const { events } = await captureBatch((c) =>
			c.track.lead({
				source: "newsletter",
				externalUserId: "user@example.com",
			}),
		);

		expect(events[0]?.name).toBe("lead_qualified");
		expect(events[0]?.properties).toEqual({ source: "newsletter" });
	});

	test("generic track normalizes the pre-0.15 lead name to lead_qualified", async () => {
		const { events } = await captureBatch((c) =>
			c.track({
				event: "lead" as unknown as "lead_qualified",
				properties: { source: "newsletter" },
				externalUserId: "user@example.com",
			}),
		);

		expect(events[0]?.name).toBe("lead_qualified");
	});

	test("converted carries amount, currency and a backdated occurredAt", async () => {
		const { events } = await captureBatch((c) =>
			c.track.converted({
				amount: 85,
				currency: "EUR",
				occurredAt: "2026-01-15T10:00:00.000Z",
				externalUserId: "user@example.com",
			}),
		);

		expect(events[0]?.name).toBe("converted");
		expect(events[0]?.properties).toEqual({
			amount: 85,
			currency: "EUR",
			occurredAt: "2026-01-15T10:00:00.000Z",
		});
		expect(events[0]?.correlation.externalUserId).toBe("user@example.com");
	});
});

async function readJson(req: IncomingMessage): Promise<unknown> {
	const chunks: Buffer[] = [];
	for await (const chunk of req) {
		chunks.push(
			typeof chunk === "string" ? Buffer.from(chunk) : (chunk as Buffer),
		);
	}
	const raw = Buffer.concat(chunks).toString("utf8");
	return raw ? JSON.parse(raw) : {};
}
