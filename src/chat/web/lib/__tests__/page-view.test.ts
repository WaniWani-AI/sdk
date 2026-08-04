import { beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";

const win = new Window({ url: "https://shop.example.com/pricing" });
for (const key of [
	"document",
	"navigator",
	"localStorage",
	"screen",
	"location",
] as const) {
	// biome-ignore lint/suspicious/noExplicitAny: test setup
	(globalThis as any)[key] = (win as any)[key];
}
// biome-ignore lint/suspicious/noExplicitAny: test setup
(globalThis as any).window = win;

import { __resetPageViewGuard, firePageView } from "../page-view";

interface Captured {
	url: string;
	init: RequestInit;
}

function mockFetch(): { calls: Captured[]; restore: () => void } {
	const calls: Captured[] = [];
	const real = globalThis.fetch;
	// biome-ignore lint/suspicious/noExplicitAny: test stub
	(globalThis as any).fetch = async (url: any, init: any) => {
		calls.push({ url: String(url), init });
		return new Response(null, { status: 202 });
	};
	return {
		calls,
		restore: () => {
			globalThis.fetch = real;
		},
	};
}

beforeEach(() => {
	__resetPageViewGuard();
	try {
		localStorage.clear();
	} catch {
		// ignore
	}
});

describe("firePageView", () => {
	test("POSTs a page.viewed event to the canonical ingest with bearer auth and visitor attribution", async () => {
		const { calls, restore } = mockFetch();
		try {
			await firePageView({
				api: "https://app.waniwani.ai/api/mcp/chat",
				token: "wwp_test",
				channelId: "chan_1",
				mode: "floating",
				source: "acme-web",
			});
			expect(calls).toHaveLength(1);
			const [call] = calls;
			// Same canonical V2 batch ingest every other event uses.
			expect(call.url).toBe("https://app.waniwani.ai/api/mcp/events/v2/batch");
			expect(call.init.method).toBe("POST");
			const headers = call.init.headers as Record<string, string>;
			expect(headers.Authorization).toBe("Bearer wwp_test");

			const batch = JSON.parse(call.init.body as string);
			expect(Array.isArray(batch.events)).toBe(true);
			expect(batch.events).toHaveLength(1);
			const [ev] = batch.events;
			expect(ev.type).toBe("mcp.event");
			expect(ev.name).toBe("page.viewed");
			// Carries the channel's configured source, not a generic "widget".
			expect(ev.source).toBe("acme-web");
			// Anonymous device id is the identity; no session is ever minted.
			expect(typeof ev.correlation.visitorId).toBe("string");
			expect(ev.correlation.visitorId.length).toBeGreaterThan(0);
			expect(ev.correlation.sessionId).toBeUndefined();
			expect(ev.properties.channelId).toBe("chan_1");
			expect(ev.properties.mode).toBe("floating");
		} finally {
			restore();
		}
	});

	test("fires at most once per (api, token, channel) per page", async () => {
		const { calls, restore } = mockFetch();
		try {
			const opts = {
				api: "https://app.waniwani.ai/api/mcp/chat",
				token: "wwp_test",
				channelId: "chan_1",
				source: "acme-web",
			} as const;
			await firePageView(opts);
			await firePageView(opts);
			await firePageView(opts);
			expect(calls).toHaveLength(1);
		} finally {
			restore();
		}
	});

	test("is a no-op without an api or token", async () => {
		const { calls, restore } = mockFetch();
		try {
			await firePageView({ api: "", token: "wwp_test", source: "acme-web" });
			await firePageView({
				api: "https://app.waniwani.ai/api/mcp/chat",
				token: "",
				source: "acme-web",
			});
			expect(calls).toHaveLength(0);
		} finally {
			restore();
		}
	});

	test("fires without a source tag when the channel has no configured source", async () => {
		const { calls, restore } = mockFetch();
		try {
			// A channel with a blank Analytics source still records page views;
			// attribution rides on `properties.channelId`. No source tag is sent,
			// and none is invented.
			await firePageView({
				api: "https://app.waniwani.ai/api/mcp/chat",
				token: "wwp_test",
				channelId: "chan_1",
			});
			expect(calls).toHaveLength(1);
			const batch = JSON.parse(calls[0].init.body as string);
			const [ev] = batch.events;
			expect(ev.name).toBe("page.viewed");
			expect("source" in ev).toBe(false);
			expect(ev.properties.channelId).toBe("chan_1");
		} finally {
			restore();
		}
	});

	test("rolls back the guard so a failed send can retry on next mount", async () => {
		const real = globalThis.fetch;
		let attempts = 0;
		// biome-ignore lint/suspicious/noExplicitAny: test stub
		(globalThis as any).fetch = async () => {
			attempts++;
			if (attempts === 1) {
				throw new Error("network down");
			}
			return new Response(null, { status: 202 });
		};
		try {
			const opts = {
				api: "https://app.waniwani.ai/api/mcp/chat",
				token: "wwp_test",
				source: "acme-web",
			} as const;
			await firePageView(opts); // fails, guard rolled back
			await firePageView(opts); // succeeds
			expect(attempts).toBe(2);
		} finally {
			globalThis.fetch = real;
		}
	});
});
