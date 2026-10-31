import { beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";

const win = new Window({ url: "https://shop.example.com/pricing?utm=x" });
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

import {
	__resetBootTiming,
	buildTimingPayload,
	createRecorder,
	sendTiming,
	setTimingMetadata,
	startTurn,
	startWidget,
} from "../timing";

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
		return new Response(null, { status: 404 });
	};
	return {
		calls,
		restore: () => {
			globalThis.fetch = real;
		},
	};
}

const target = {
	api: "https://app.waniwani.ai/api/mcp/chat?test=1",
	token: "wwp_test",
	channelId: "chan_1",
	sessionId: "sess_1",
};

beforeEach(() => {
	__resetBootTiming();
	setTimingMetadata({ chatTimingLogs: "true" });
	try {
		localStorage.clear();
	} catch {
		// ignore
	}
});

describe("buildTimingPayload", () => {
	test("reports the page host without the path, and no session on boot", () => {
		const payload = buildTimingPayload(
			"boot",
			target,
			{ mode: "floating" },
			{},
		);
		expect(payload.pageHost).toBe("shop.example.com");
		expect(payload.sessionId).toBeUndefined();
		expect(payload.channelId).toBe("chan_1");
		expect(payload.kind).toBe("boot");
		expect(typeof payload.visitorId).toBe("string");
		expect(JSON.stringify(payload)).not.toContain("/pricing");
	});

	test("carries the session on turn and widget payloads", () => {
		expect(buildTimingPayload("turn", target, {}, {}).sessionId).toBe("sess_1");
		expect(buildTimingPayload("widget", target, {}, {}).sessionId).toBe(
			"sess_1",
		);
	});

	test("omits a channel it does not know", () => {
		const payload = buildTimingPayload(
			"turn",
			{ ...target, channelId: "" },
			{},
			{},
		);
		expect(payload.channelId).toBeUndefined();
	});

	test("keeps metrics to whole milliseconds inside the accepted range", () => {
		const payload = buildTimingPayload(
			"turn",
			target,
			{},
			{
				rounded: 12.7,
				negative: -5,
				huge: 600_001,
				broken: Number.NaN,
				infinite: Number.POSITIVE_INFINITY,
			},
		);
		expect(payload.metrics).toEqual({ rounded: 13 });
	});

	test("caps metrics at 40 keys and tags at 10", () => {
		const metrics: Record<string, number> = {};
		for (let i = 0; i < 60; i++) {
			metrics[`m${i}`] = i;
		}
		const tags: Record<string, string> = {};
		for (let i = 0; i < 20; i++) {
			tags[`t${i}`] = "v";
		}
		const payload = buildTimingPayload("turn", target, tags, metrics);
		expect(Object.keys(payload.metrics as object)).toHaveLength(40);
		expect(Object.keys(payload.tags as object)).toHaveLength(10);
	});

	test("drops tag values that are neither string nor boolean", () => {
		const payload = buildTimingPayload(
			"turn",
			target,
			// biome-ignore lint/suspicious/noExplicitAny: test input
			{ mode: "inline", missing: undefined, junk: 3 as any },
			{},
		);
		expect(payload.tags).toEqual({ mode: "inline" });
	});
});

describe("sendTiming", () => {
	test("POSTs to the chat mount's /timing with the bearer token, keeping the base query", () => {
		const { calls, restore } = mockFetch();
		try {
			sendTiming("boot", target, { mode: "inline" }, { chatVisible: 120 });
			expect(calls).toHaveLength(1);
			expect(calls[0].url).toBe(
				"https://app.waniwani.ai/api/mcp/chat/timing?test=1",
			);
			expect(calls[0].init.method).toBe("POST");
			expect(calls[0].init.keepalive).toBe(true);
			expect(
				(calls[0].init.headers as Record<string, string>).Authorization,
			).toBe("Bearer wwp_test");
			const body = JSON.parse(String(calls[0].init.body));
			expect(body.metrics).toEqual({ chatVisible: 120 });
			expect(body.tags).toEqual({ mode: "inline" });
		} finally {
			restore();
		}
	});

	test("sends nothing without both an api and a token", () => {
		const { calls, restore } = mockFetch();
		try {
			sendTiming("boot", { api: target.api }, {}, {});
			sendTiming("boot", { token: target.token }, {}, {});
			expect(calls).toHaveLength(0);
		} finally {
			restore();
		}
	});

	test("swallows a rejected request", () => {
		const real = globalThis.fetch;
		// biome-ignore lint/suspicious/noExplicitAny: test stub
		(globalThis as any).fetch = () => Promise.reject(new Error("offline"));
		try {
			expect(() => sendTiming("boot", target, {}, {})).not.toThrow();
		} finally {
			globalThis.fetch = real;
		}
	});
});

describe("setTimingMetadata", () => {
	test("holds beacons until the verdict, then sends them on true", () => {
		__resetBootTiming();
		const { calls, restore } = mockFetch();
		try {
			sendTiming("boot", target, {}, { chatVisible: 1 });
			sendTiming("turn", target, {}, { streamEnd: 2 });
			expect(calls).toHaveLength(0);
			setTimingMetadata({ chatTimingLogs: "true" });
			expect(calls).toHaveLength(2);
			sendTiming("widget", target, {}, {});
			expect(calls).toHaveLength(3);
		} finally {
			restore();
		}
	});

	test("drops the held beacons on false and sends nothing after", () => {
		__resetBootTiming();
		const { calls, restore } = mockFetch();
		try {
			sendTiming("boot", target, {}, { chatVisible: 1 });
			setTimingMetadata({ chatTimingLogs: "false" });
			sendTiming("turn", target, {}, {});
			expect(calls).toHaveLength(0);
		} finally {
			restore();
		}
	});

	test("reads chatTimingLogs trimmed and case-insensitive", () => {
		const cases: Array<[Record<string, string> | null | undefined, number]> = [
			[{ chatTimingLogs: " TRUE " }, 1],
			[{ chatTimingLogs: "yes" }, 0],
			[{ other: "true" }, 0],
			[null, 0],
			[undefined, 0],
		];
		for (const [metadata, expected] of cases) {
			__resetBootTiming();
			const { calls, restore } = mockFetch();
			try {
				setTimingMetadata(metadata);
				sendTiming("turn", target, {}, {});
				expect(calls).toHaveLength(expected);
			} finally {
				restore();
			}
		}
	});

	test("sends nothing when no remote config ever answers", async () => {
		__resetBootTiming();
		const { calls, restore } = mockFetch();
		try {
			sendTiming("boot", target, {}, {});
			sendTiming("turn", target, {}, {});
			sendTiming("widget", target, {}, {});
			await new Promise((resolve) => setTimeout(resolve, 10));
			expect(calls).toHaveLength(0);
		} finally {
			restore();
		}
	});
});

describe("createRecorder", () => {
	test("keeps the first stamp of a repeated mark, relative to its own zero", () => {
		const recorder = createRecorder("turn", 100);
		recorder.mark("firstChunk", 150);
		recorder.mark("firstChunk", 400);
		expect(recorder.metrics.firstChunk).toBe(50);
		expect(recorder.has("firstChunk")).toBe(true);
		expect(recorder.has("streamEnd")).toBe(false);
	});
});

describe("startTurn", () => {
	test("stamps the first byte and each chunk type once, then reports", async () => {
		const { calls, restore } = mockFetch();
		try {
			const turn = startTurn(3);
			const body = new ReadableStream<Uint8Array>({
				start(controller) {
					const encode = (s: string) => new TextEncoder().encode(s);
					controller.enqueue(encode('data: {"type":"start"}\n'));
					controller.enqueue(encode('data: {"type":"text-delta"}\n'));
					controller.enqueue(encode('data: {"type":"tool-input-start"}\n'));
					controller.enqueue(
						encode('data: {"type":"tool-output-available"}\n'),
					);
					controller.close();
				},
			});
			const instrumented = turn.instrument(
				new Response(body, { status: 200, headers: { "x-session-id": "s1" } }),
			);
			expect(instrumented.headers.get("x-session-id")).toBe("s1");
			expect(await instrumented.text()).toContain("tool-output-available");

			turn.mark("streamEnd");
			turn.report(target, { outcome: "ok" });
			turn.report(target, { outcome: "ok" });

			expect(calls).toHaveLength(1);
			const payload = JSON.parse(String(calls[0].init.body));
			expect(payload.kind).toBe("turn");
			expect(payload.metrics.turnIndex).toBe(3);
			for (const name of [
				"firstChunk",
				"firstText",
				"firstToolInput",
				"firstToolOutput",
				"streamEnd",
			]) {
				expect(payload.metrics[name]).toBeGreaterThanOrEqual(0);
			}
		} finally {
			restore();
		}
	});

	test("hands back a failed response untouched", () => {
		const turn = startTurn(1);
		const failed = new Response("nope", { status: 500 });
		expect(turn.instrument(failed)).toBe(failed);
	});
});

describe("startWidget", () => {
	test("reports once, with the query stripped off the resource uri", () => {
		const reports: unknown[] = [];
		const widget = startWidget("ui://views/ext-apps/quote.html?v=2", (r) =>
			reports.push(r),
		);
		widget.mark("initialized");
		widget.mark("firstSize");
		widget.report("ok", 2);
		widget.report("timeout", 2);
		expect(reports).toHaveLength(1);
		expect(reports[0]).toMatchObject({
			widget: "ui://views/ext-apps/quote.html",
			outcome: "ok",
		});
		expect(widget.has("initialized")).toBe(true);
		expect(
			(reports[0] as { metrics: Record<string, number> }).metrics.retries,
		).toBe(2);
	});
});
