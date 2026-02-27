import { beforeEach, describe, expect, mock, test } from "bun:test";

import type { WidgetEvent } from "../widget-transport";

// ── WidgetTransport tests ─────────────────────────────────────────────

describe("WidgetTransport", () => {
	const mockFetch = mock(() =>
		Promise.resolve(new Response("{}", { status: 200 })),
	);

	beforeEach(() => {
		mockFetch.mockClear();
		globalThis.fetch = mockFetch as unknown as typeof fetch;
	});

	test("batches and sends events in V2 format via fetch", async () => {
		const { WidgetTransport } = await import("../widget-transport");
		const transport = new WidgetTransport({
			endpoint: "https://app.waniwani.ai/api/mcp/events/v2/batch",
			token: "test-jwt-token",
		});

		transport.send([
			{
				event_id: "e1",
				event_type: "widget_click",
				timestamp: new Date().toISOString(),
				source: "widget",
				session_id: "sess-1",
				trace_id: "trace-1",
			},
		]);

		await transport.flush();
		transport.stop();

		expect(mockFetch).toHaveBeenCalledTimes(1);
		const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
		expect(url).toBe("https://app.waniwani.ai/api/mcp/events/v2/batch");
		expect(opts.method).toBe("POST");

		// Check Authorization header
		const headers = opts.headers as Record<string, string>;
		expect(headers.Authorization).toBe("Bearer test-jwt-token");

		// Check V2 batch format
		const body = JSON.parse(opts.body as string);
		expect(body.sentAt).toBeDefined();
		expect(body.source.sdk).toBe("@waniwani/sdk");
		expect(body.events).toHaveLength(1);
		expect(body.events[0].id).toBe("e1");
		expect(body.events[0].type).toBe("mcp.event");
		expect(body.events[0].name).toBe("widget_click");
		expect(body.events[0].source).toBe("widget");
		expect(body.events[0].correlation.sessionId).toBe("sess-1");
		expect(body.events[0].correlation.traceId).toBe("trace-1");
	});

	test("stops permanently on 401", async () => {
		mockFetch.mockImplementationOnce(() =>
			Promise.resolve(new Response("{}", { status: 401 })),
		);

		const { WidgetTransport } = await import("../widget-transport");
		const transport = new WidgetTransport({
			endpoint: "https://app.waniwani.ai/api/mcp/events/v2/batch",
		});

		transport.send([
			{
				event_id: "e1",
				event_type: "test",
				timestamp: new Date().toISOString(),
				source: "widget",
			},
		]);

		await transport.flush();

		// Should ignore subsequent sends after 401
		transport.send([
			{
				event_id: "e2",
				event_type: "test2",
				timestamp: new Date().toISOString(),
				source: "widget",
			},
		]);

		await transport.flush();
		transport.stop();

		// Only the first fetch should have been made
		expect(mockFetch).toHaveBeenCalledTimes(1);
	});

	test("does not flush when buffer is empty", async () => {
		const { WidgetTransport } = await import("../widget-transport");
		const transport = new WidgetTransport({
			endpoint: "https://app.waniwani.ai/api/mcp/events/v2/batch",
		});

		await transport.flush();
		transport.stop();

		expect(mockFetch).toHaveBeenCalledTimes(0);
	});

	test("does not send after stop()", async () => {
		const { WidgetTransport } = await import("../widget-transport");
		const transport = new WidgetTransport({
			endpoint: "https://app.waniwani.ai/api/mcp/events/v2/batch",
		});

		transport.stop();

		transport.send([
			{
				event_id: "e1",
				event_type: "test",
				timestamp: new Date().toISOString(),
				source: "widget",
			},
		]);

		await transport.flush();

		expect(mockFetch).toHaveBeenCalledTimes(0);
	});

	test("maps non-widget event types with widget_ prefix", async () => {
		const { WidgetTransport } = await import("../widget-transport");
		const transport = new WidgetTransport({
			endpoint: "https://app.waniwani.ai/api/mcp/events/v2/batch",
		});

		transport.send([
			{
				event_id: "e1",
				event_type: "identify",
				timestamp: new Date().toISOString(),
				source: "widget",
				user_id: "user-123",
			},
		]);

		await transport.flush();
		transport.stop();

		const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
		const body = JSON.parse(opts.body as string);
		expect(body.events[0].name).toBe("widget_identify");
		expect(body.events[0].correlation.externalUserId).toBe("user-123");
	});
});

// ── Auto-capture unit tests (no DOM required) ─────────────────────────

describe("auto-capture (baseFields)", () => {
	test("WidgetEvent shape has required fields", () => {
		const event: WidgetEvent = {
			event_id: "abc",
			event_type: "widget_click",
			timestamp: new Date().toISOString(),
			source: "widget",
			metadata: { click_x: 100 },
		};
		expect(event.event_id).toBe("abc");
		expect(event.event_type).toBe("widget_click");
		expect(event.source).toBe("widget");
		expect((event.metadata as Record<string, unknown>)?.click_x).toBe(100);
	});
});
