import { beforeEach, describe, expect, it, mock } from "bun:test";
import { createTrackingRoute } from "../tracking-route";

// Mock fetch to intercept outbound tracking calls
const mockFetch = mock(() =>
	Promise.resolve(
		new Response(JSON.stringify({ accepted: 1, rejected: [] }), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		}),
	),
);

beforeEach(() => {
	mockFetch.mockClear();
	globalThis.fetch = mockFetch as unknown as typeof fetch;
});

function makeRequest(body: unknown): Request {
	return new Request("http://localhost/api/waniwani/track", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
}

function makeBatchRequest(events: Array<Record<string, unknown>>): Request {
	return makeRequest({
		events,
		sentAt: new Date().toISOString(),
	});
}

describe("createTrackingRoute", () => {
	it("returns 400 for invalid JSON", async () => {
		const handler = createTrackingRoute({ apiKey: "test-key" });
		const request = new Request("http://localhost/api/waniwani/track", {
			method: "POST",
			body: "not json",
		});
		const response = await handler(request);
		expect(response.status).toBe(400);
		const body = await response.json();
		expect(body.error).toBe("Invalid JSON");
	});

	it("returns 400 for missing events array", async () => {
		const handler = createTrackingRoute({ apiKey: "test-key" });
		const response = await handler(makeRequest({ properties: {} }));
		expect(response.status).toBe(400);
		const body = await response.json();
		expect(body.error).toBe("Missing or empty events array");
	});

	it("returns 400 for empty events array", async () => {
		const handler = createTrackingRoute({ apiKey: "test-key" });
		const response = await handler(makeBatchRequest([]));
		expect(response.status).toBe(400);
		const body = await response.json();
		expect(body.error).toBe("Missing or empty events array");
	});

	it("returns 200 with accepted count for valid batch", async () => {
		const handler = createTrackingRoute({
			apiKey: "test-key",
			apiUrl: "http://localhost:3000",
		});
		const response = await handler(
			makeBatchRequest([
				{
					event_id: "evt-1",
					event_type: "widget_click",
					timestamp: new Date().toISOString(),
					source: "widget",
					session_id: "sess-1",
					metadata: { target_tag: "button" },
				},
			]),
		);
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.ok).toBe(true);
		expect(body.accepted).toBe(1);
	});

	it("forwards events to the WaniWani backend", async () => {
		const handler = createTrackingRoute({
			apiKey: "test-key",
			apiUrl: "http://localhost:3000",
		});
		await handler(
			makeBatchRequest([
				{
					event_id: "evt-1",
					event_type: "widget_click",
					timestamp: new Date().toISOString(),
					source: "widget",
				},
			]),
		);
		// The SDK client uses fetch internally to send to the batch endpoint
		expect(mockFetch).toHaveBeenCalled();
		const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
		expect(url).toContain("/api/mcp/events/v2/batch");
	});
});
