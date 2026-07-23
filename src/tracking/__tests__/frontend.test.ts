import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

import { createFrontendClient } from "../frontend.js";
import type { V2BatchRequest } from "../v2-types.js";

const ENDPOINT = "https://app.waniwani.ai/api/mcp/events/v2/batch";

describe("createFrontendClient", () => {
	const originalFetch = globalThis.fetch;
	const mockFetch = mock(() =>
		Promise.resolve(new Response("{}", { status: 200 })),
	);

	beforeEach(() => {
		mockFetch.mockClear();
		globalThis.fetch = mockFetch as unknown as typeof fetch;
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	function sentBatches(): V2BatchRequest[] {
		return mockFetch.mock.calls.map((call) => {
			const [, opts] = call as unknown as [string, RequestInit];
			return JSON.parse(opts.body as string) as V2BatchRequest;
		});
	}

	test("sends typed events to the endpoint with the bearer token", async () => {
		const client = createFrontendClient({
			endpoint: ENDPOINT,
			token: "wwp_test",
			source: "chatgpt",
			identity: () => ({ sessionId: "sess-1", traceId: "trace-1" }),
		});

		await client.track({ event: "quote.requested" });
		await client.flush();
		await client.shutdown();

		expect(mockFetch).toHaveBeenCalledTimes(1);
		const [url, opts] = mockFetch.mock.calls[0] as unknown as [
			string,
			RequestInit,
		];
		expect(url).toBe(ENDPOINT);
		const headers = opts.headers as Record<string, string>;
		expect(headers.Authorization).toBe("Bearer wwp_test");

		const [batch] = sentBatches();
		expect(batch.events).toHaveLength(1);
		const event = batch.events[0];
		expect(event?.name).toBe("quote.requested");
		expect(event?.source).toBe("chatgpt");
		expect(event?.correlation.sessionId).toBe("sess-1");
		expect(event?.correlation.traceId).toBe("trace-1");
	});

	test("revenue helpers emit first-class taxonomy events", async () => {
		const client = createFrontendClient({
			endpoint: ENDPOINT,
			token: "wwp_test",
			source: "chatgpt",
			identity: () => ({ sessionId: "sess-1" }),
		});

		await client.track.priceShown({ amount: 49, currency: "EUR" });
		await client.track.optionSelected({
			id: "pro",
			amount: 49,
			currency: "EUR",
		});
		await client.flush();
		await client.shutdown();

		const events = sentBatches().flatMap((batch) => batch.events);
		expect(events.map((event) => event.name)).toEqual([
			"price_shown",
			"option_selected",
		]);
		expect(events[0]?.properties).toMatchObject({
			amount: 49,
			currency: "EUR",
		});
		expect(events[0]?.correlation.sessionId).toBe("sess-1");
	});

	test("identity is read at emit time, so a late session id is picked up", async () => {
		let sessionId: string | undefined;
		const client = createFrontendClient({
			endpoint: ENDPOINT,
			token: "wwp_test",
			source: "web",
			identity: () => ({ sessionId, visitorId: "vis-1" }),
		});

		await client.track({ event: "page.viewed" });
		sessionId = "sess-late";
		await client.track({ event: "quote.requested" });
		await client.flush();
		await client.shutdown();

		const events = sentBatches().flatMap((batch) => batch.events);
		expect(events[0]?.correlation.sessionId).toBeUndefined();
		expect(events[0]?.correlation.visitorId).toBe("vis-1");
		expect(events[1]?.correlation.sessionId).toBe("sess-late");
	});

	test("identify emits user.identified and stamps later events", async () => {
		const client = createFrontendClient({
			endpoint: ENDPOINT,
			token: "wwp_test",
			source: "chatgpt",
			identity: () => ({ sessionId: "sess-1" }),
		});

		await client.identify("user-42", { plan: "pro" });
		await client.track({ event: "quote.requested" });
		await client.flush();
		await client.shutdown();

		const events = sentBatches().flatMap((batch) => batch.events);
		expect(events[0]?.name).toBe("user.identified");
		expect(events[0]?.correlation.externalUserId).toBe("user-42");
		expect(events[0]?.properties).toMatchObject({ plan: "pro" });
		expect(events[1]?.correlation.externalUserId).toBe("user-42");
	});

	test("omits the Authorization header when no token is configured", async () => {
		const client = createFrontendClient({
			endpoint: "https://example.com/api/tracking",
			source: "web",
			identity: () => ({ visitorId: "vis-1" }),
		});

		await client.track({ event: "page.viewed" });
		await client.flush();
		await client.shutdown();

		const [url, opts] = mockFetch.mock.calls[0] as unknown as [
			string,
			RequestInit,
		];
		expect(url).toBe("https://example.com/api/tracking");
		const headers = opts.headers as Record<string, string>;
		expect(headers.Authorization).toBeUndefined();
	});

	test("explicit event fields win over ambient identity", async () => {
		const client = createFrontendClient({
			endpoint: ENDPOINT,
			token: "wwp_test",
			source: "web",
			identity: () => ({ sessionId: "sess-ambient" }),
		});

		await client.track({
			event: "converted",
			properties: { amount: 85, currency: "EUR" },
			sessionId: "sess-explicit",
			source: "backfill",
		});
		await client.flush();
		await client.shutdown();

		const events = sentBatches().flatMap((batch) => batch.events);
		expect(events[0]?.correlation.sessionId).toBe("sess-explicit");
		expect(events[0]?.source).toBe("backfill");
	});
});
