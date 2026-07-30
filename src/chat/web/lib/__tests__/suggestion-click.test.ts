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

import {
	fireSuggestionClick,
	fireSuggestionShown,
	resolveClickAttribution,
	resolveShownPrompts,
} from "../suggestion-click";

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

const BASE = {
	api: "https://app.waniwani.ai/api/mcp/chat",
	token: "wwp_test",
	channelId: "chan_1",
	mode: "inline",
	source: "acme-web",
	promptId: "prompt_1",
	origin: "page",
	text: "What does Pro cost?",
	index: 0,
} as const;

beforeEach(() => {
	try {
		localStorage.clear();
	} catch {
		// ignore
	}
});

describe("resolveClickAttribution", () => {
	const list = [
		{ id: "p1", text: "Authored" },
		{ id: null, text: "From the fixed list" },
	];

	test("an authored prompt keeps its id and upgrades channel to page", () => {
		expect(resolveClickAttribution(list, "Authored", "channel")).toEqual({
			promptId: "p1",
			origin: "page",
		});
	});

	test("a fixed-list prompt has no id and keeps the reported origin", () => {
		expect(
			resolveClickAttribution(list, "From the fixed list", "channel"),
		).toEqual({ promptId: null, origin: "channel" });
	});

	test("a text absent from the list keeps its reported origin", () => {
		expect(
			resolveClickAttribution(list, "Something streamed", "followup"),
		).toEqual({ promptId: null, origin: "followup" });
		expect(resolveClickAttribution([], "Anything", "flow")).toEqual({
			promptId: null,
			origin: "flow",
		});
	});

	test("duplicate texts attribute to the first match", () => {
		expect(
			resolveClickAttribution(
				[
					{ id: "first", text: "Same" },
					{ id: "second", text: "Same" },
				],
				"Same",
				"channel",
			),
		).toEqual({ promptId: "first", origin: "page" });
	});
});

describe("fireSuggestionClick", () => {
	test("POSTs a suggestion.clicked event to the canonical ingest with the prompt id", async () => {
		const { calls, restore } = mockFetch();
		try {
			await fireSuggestionClick({ ...BASE });
			expect(calls).toHaveLength(1);
			const [call] = calls;
			// Same canonical V2 batch ingest `page.viewed` uses.
			expect(call.url).toBe("https://app.waniwani.ai/api/mcp/events/v2/batch");
			expect(call.init.method).toBe("POST");
			const headers = call.init.headers as Record<string, string>;
			expect(headers.Authorization).toBe("Bearer wwp_test");

			const batch = JSON.parse(call.init.body as string);
			expect(batch.events).toHaveLength(1);
			const [ev] = batch.events;
			expect(ev.type).toBe("mcp.event");
			expect(ev.name).toBe("suggestion.clicked");
			expect(ev.source).toBe("acme-web");
			expect(typeof ev.correlation.visitorId).toBe("string");
			expect(ev.correlation.visitorId.length).toBeGreaterThan(0);
			expect(ev.properties).toMatchObject({
				promptId: "prompt_1",
				origin: "page",
				text: "What does Pro cost?",
				index: 0,
				channelId: "chan_1",
				mode: "inline",
				url: "https://shop.example.com/pricing",
			});
		} finally {
			restore();
		}
	});

	test("carries the session id only once a conversation exists", async () => {
		const { calls, restore } = mockFetch();
		try {
			// The usual case: the starter click is what starts the conversation.
			await fireSuggestionClick({ ...BASE });
			await fireSuggestionClick({ ...BASE, sessionId: "sess_1" });
			expect(calls).toHaveLength(2);
			const first = JSON.parse(calls[0].init.body as string).events[0];
			const second = JSON.parse(calls[1].init.body as string).events[0];
			expect("sessionId" in first.correlation).toBe(false);
			expect(second.correlation.sessionId).toBe("sess_1");
		} finally {
			restore();
		}
	});

	test("fires on every click — no once-per-page guard", async () => {
		const { calls, restore } = mockFetch();
		try {
			await fireSuggestionClick({ ...BASE });
			await fireSuggestionClick({ ...BASE });
			expect(calls).toHaveLength(2);
		} finally {
			restore();
		}
	});

	test("fires without a source tag when the channel has no configured source", async () => {
		const { calls, restore } = mockFetch();
		try {
			await fireSuggestionClick({ ...BASE, source: undefined });
			expect(calls).toHaveLength(1);
			const [ev] = JSON.parse(calls[0].init.body as string).events;
			expect("source" in ev).toBe(false);
			expect(ev.properties.channelId).toBe("chan_1");
		} finally {
			restore();
		}
	});

	test("sends a null promptId for a channel prompt", async () => {
		const { calls, restore } = mockFetch();
		try {
			await fireSuggestionClick({
				...BASE,
				promptId: null,
				origin: "channel",
			});
			const [ev] = JSON.parse(calls[0].init.body as string).events;
			expect(ev.properties.promptId).toBe(null);
			expect(ev.properties.origin).toBe("channel");
		} finally {
			restore();
		}
	});

	test("is a no-op without an api or token", async () => {
		const { calls, restore } = mockFetch();
		try {
			await fireSuggestionClick({ ...BASE, api: "" });
			await fireSuggestionClick({ ...BASE, token: "" });
			expect(calls).toHaveLength(0);
		} finally {
			restore();
		}
	});

	test("never throws when the network is down", async () => {
		const real = globalThis.fetch;
		// biome-ignore lint/suspicious/noExplicitAny: test stub
		(globalThis as any).fetch = async () => {
			throw new Error("network down");
		};
		try {
			await fireSuggestionClick({ ...BASE });
		} finally {
			globalThis.fetch = real;
		}
	});
});

describe("resolveShownPrompts", () => {
	const list = [
		{ id: "p1", text: "Authored one" },
		{ id: "p2", text: "Authored two" },
	];

	test("an authored set keeps every id and upgrades channel to page", () => {
		expect(
			resolveShownPrompts(list, ["Authored one", "Authored two"], "channel"),
		).toEqual({
			prompts: [
				{ id: "p1", text: "Authored one" },
				{ id: "p2", text: "Authored two" },
			],
			origin: "page",
		});
	});

	test("texts absent from the list keep the reported origin with null ids", () => {
		expect(
			resolveShownPrompts(list, ["Streamed A", "Streamed B"], "followup"),
		).toEqual({
			prompts: [
				{ id: null, text: "Streamed A" },
				{ id: null, text: "Streamed B" },
			],
			origin: "followup",
		});
	});

	test("a fixed-list set has no ids and stays channel", () => {
		const fallbackList = [{ id: null, text: "From the fixed list" }];
		expect(
			resolveShownPrompts(fallbackList, ["From the fixed list"], "channel"),
		).toEqual({
			prompts: [{ id: null, text: "From the fixed list" }],
			origin: "channel",
		});
	});

	test("an empty set keeps the reported origin", () => {
		expect(resolveShownPrompts(list, [], "channel")).toEqual({
			prompts: [],
			origin: "channel",
		});
	});
});

describe("fireSuggestionShown", () => {
	const SHOWN_BASE = {
		api: BASE.api,
		token: BASE.token,
		channelId: BASE.channelId,
		mode: BASE.mode,
		source: BASE.source,
		prompts: [
			{ id: "p1", text: "Authored one" },
			{ id: null, text: "From the fixed list" },
		],
		origin: "page",
	} as const;

	test("POSTs one suggestion.shown event carrying the whole set", async () => {
		const { calls, restore } = mockFetch();
		try {
			await fireSuggestionShown({
				...SHOWN_BASE,
				prompts: [...SHOWN_BASE.prompts],
			});
			expect(calls).toHaveLength(1);
			const [call] = calls;
			expect(call.url).toBe("https://app.waniwani.ai/api/mcp/events/v2/batch");
			const [ev] = JSON.parse(call.init.body as string).events;
			expect(ev.name).toBe("suggestion.shown");
			expect(ev.properties).toMatchObject({
				prompts: [
					{ id: "p1", text: "Authored one" },
					{ id: null, text: "From the fixed list" },
				],
				count: 2,
				origin: "page",
				channelId: "chan_1",
				mode: "inline",
				url: "https://shop.example.com/pricing",
			});
		} finally {
			restore();
		}
	});

	test("an empty set is a no-op, not an event", async () => {
		const { calls, restore } = mockFetch();
		try {
			await fireSuggestionShown({ ...SHOWN_BASE, prompts: [] });
			expect(calls).toHaveLength(0);
		} finally {
			restore();
		}
	});

	test("is a no-op without an api or token", async () => {
		const { calls, restore } = mockFetch();
		try {
			await fireSuggestionShown({
				...SHOWN_BASE,
				prompts: [...SHOWN_BASE.prompts],
				api: "",
			});
			expect(calls).toHaveLength(0);
		} finally {
			restore();
		}
	});
});
