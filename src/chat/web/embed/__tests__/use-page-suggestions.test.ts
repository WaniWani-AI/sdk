import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
// Type-only, so it doesn't pull the module in before the globals below exist.
import type { EmbedConfig } from "../config";

const win = new Window({ url: "https://host.example/pricing" });
for (const key of [
	"document",
	"navigator",
	"history",
	"location",
	"HTMLElement",
	"HTMLDivElement",
	"Element",
	"Node",
	"Text",
	"Comment",
	"DocumentFragment",
	"Event",
	"CustomEvent",
	"requestAnimationFrame",
	"cancelAnimationFrame",
	"getComputedStyle",
] as const) {
	// biome-ignore lint/suspicious/noExplicitAny: happy-dom globals for the render harness
	(globalThis as any)[key] = (win as any)[key];
}
// biome-ignore lint/suspicious/noExplicitAny: happy-dom globals for the render harness
(globalThis as any).window = win;
// biome-ignore lint/suspicious/noExplicitAny: react act environment flag
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// ---------------------------------------------------------------------------
// fetch stub — every call is parked until the test resolves it by hand, so a
// response can be delivered *after* a navigation to prove the stale-overwrite
// guard works. Deliberately does not reject on abort: what's under test is the
// hook's own `signal.aborted` check, not AbortController itself.
// ---------------------------------------------------------------------------

interface PendingRequest {
	url: string;
	headers: Record<string, string>;
	signal: AbortSignal | undefined;
	resolve: (res: { ok: boolean; body: unknown }) => void;
}

let pending: PendingRequest[] = [];

const originalFetch = globalThis.fetch;

// biome-ignore lint/suspicious/noExplicitAny: minimal fetch stand-in
(globalThis as any).fetch = (input: any, init: any) =>
	new Promise((resolveFetch) => {
		pending.push({
			url: String(input),
			headers: (init?.headers ?? {}) as Record<string, string>,
			signal: init?.signal,
			resolve: ({ ok, body }) => resolveFetch({ ok, json: async () => body }),
		});
	});

// Bun shares one global scope across test files. This stub never settles on
// its own, so leaving it installed would hang every later file that fetches.
afterAll(() => {
	globalThis.fetch = originalFetch;
});

const { act, createElement } = await import("react");
const { createRoot } = await import("react-dom/client");
const { parseSuggestionsResponse, resolveSuggestions, usePageSuggestions } =
	await import("../use-page-suggestions");

const BASE_CONFIG: EmbedConfig = {
	api: "https://app.waniwani.ai/api/mcp/chat",
	token: "wwp_test",
	channelId: "0b3d5f2e-1c4a-4f8b-9d2e-6a7c8b9d0e1f",
	suggestions: ["Static A", "Static B"],
};

/** Mount a probe that surfaces the hook's resolved texts. */
async function mount(config: EmbedConfig) {
	const container = win.document.createElement("div");
	let latest: string[] = [];
	function Probe() {
		latest = usePageSuggestions(config);
		return null;
	}
	// biome-ignore lint/suspicious/noExplicitAny: happy-dom Element vs DOM Element
	const root = createRoot(container as any);
	await act(async () => {
		root.render(createElement(Probe));
	});
	return {
		get value() {
			return latest;
		},
		async settle(index: number, res: { ok: boolean; body: unknown }) {
			await act(async () => {
				pending[index]?.resolve(res);
			});
		},
		async navigate(pathname: string) {
			await act(async () => {
				win.history.pushState({}, "", pathname);
			});
		},
		unmount() {
			act(() => root.unmount());
		},
	};
}

const envelope = (suggestions: unknown) => ({
	success: true,
	message: "success",
	data: { suggestions },
});

beforeEach(async () => {
	pending = [];
	await act(async () => {
		win.history.pushState({}, "", "/pricing");
	});
});

describe("parseSuggestionsResponse", () => {
	test("reads the enveloped `data.suggestions` shape the API returns", () => {
		expect(
			parseSuggestionsResponse(
				envelope([{ id: "pricing-1", text: "How much?" }]),
			),
		).toEqual([{ id: "pricing-1", text: "How much?" }]);
	});

	test("accepts a bare `{ suggestions }` root too", () => {
		expect(
			parseSuggestionsResponse({ suggestions: [{ id: null, text: "Hi" }] }),
		).toEqual([{ id: null, text: "Hi" }]);
	});

	test("keeps ids so a later click can be attributed", () => {
		const parsed = parseSuggestionsResponse(
			envelope([
				{ id: "a", text: "one" },
				{ id: null, text: "two" },
			]),
		);
		expect(parsed.map((s) => s.id)).toEqual(["a", null]);
	});

	test("coerces a non-string id to null rather than dropping the prompt", () => {
		expect(parseSuggestionsResponse(envelope([{ id: 7, text: "ok" }]))).toEqual(
			[{ id: null, text: "ok" }],
		);
	});

	test("drops entries with no usable text", () => {
		expect(
			parseSuggestionsResponse(
				envelope([
					{ id: "a", text: "" },
					{ id: "b" },
					null,
					{ id: "c", text: "kept" },
				]),
			),
		).toEqual([{ id: "c", text: "kept" }]);
	});

	test("degrades to [] on malformed bodies", () => {
		for (const body of [
			null,
			undefined,
			{},
			{ data: null },
			{ data: { suggestions: "nope" } },
			"not json",
		]) {
			expect(parseSuggestionsResponse(body)).toEqual([]);
		}
	});
});

describe("resolveSuggestions", () => {
	const fallback = ["Static A", "Static B"];

	test("prefers the page's own prompts", () => {
		expect(
			resolveSuggestions([{ id: "p1", text: "Page prompt" }], fallback),
		).toEqual([{ id: "p1", text: "Page prompt" }]);
	});

	test("falls back when nothing was fetched", () => {
		expect(resolveSuggestions(null, fallback)).toEqual([
			{ id: null, text: "Static A" },
			{ id: null, text: "Static B" },
		]);
	});

	test("treats an empty fetched set as fall-back-client-side", () => {
		expect(resolveSuggestions([], fallback)).toEqual([
			{ id: null, text: "Static A" },
			{ id: null, text: "Static B" },
		]);
	});

	test("is empty when there is nothing on either side", () => {
		expect(resolveSuggestions(null, undefined)).toEqual([]);
		expect(resolveSuggestions([], [])).toEqual([]);
	});
});

describe("usePageSuggestions", () => {
	test("is inert without the flag — no request, fixed list", async () => {
		const h = await mount({ ...BASE_CONFIG });
		expect(pending).toHaveLength(0);
		expect(h.value).toEqual(["Static A", "Static B"]);
		h.unmount();
	});

	test("makes no request when the embed has no channelId", async () => {
		const h = await mount({
			...BASE_CONFIG,
			channelId: undefined,
			dynamicSuggestions: true,
		});
		expect(pending).toHaveLength(0);
		expect(h.value).toEqual(["Static A", "Static B"]);
		h.unmount();
	});

	test("fetches the current page's prompts and swaps the pills", async () => {
		const h = await mount({ ...BASE_CONFIG, dynamicSuggestions: true });
		expect(pending).toHaveLength(1);

		const url = new URL(pending[0].url);
		expect(url.pathname).toBe("/api/mcp/chat/suggestions");
		expect(url.searchParams.get("channel")).toBe(BASE_CONFIG.channelId);
		expect(url.searchParams.get("url")).toBe("/pricing");
		expect(pending[0].headers.Authorization).toBe("Bearer wwp_test");

		// Fixed list until the response lands — never a blank card.
		expect(h.value).toEqual(["Static A", "Static B"]);

		await h.settle(0, {
			ok: true,
			body: envelope([{ id: "p1", text: "What does Pro cost?" }]),
		});
		expect(h.value).toEqual(["What does Pro cost?"]);
		h.unmount();
	});

	test("falls back to the fixed list on a non-200", async () => {
		const h = await mount({ ...BASE_CONFIG, dynamicSuggestions: true });
		await h.settle(0, { ok: false, body: { error: "INVALID_CHANNEL" } });
		expect(h.value).toEqual(["Static A", "Static B"]);
		h.unmount();
	});

	test("falls back when the page has no authored prompts", async () => {
		const h = await mount({ ...BASE_CONFIG, dynamicSuggestions: true });
		await h.settle(0, { ok: true, body: envelope([]) });
		expect(h.value).toEqual(["Static A", "Static B"]);
		h.unmount();
	});

	test("refetches with the new pathname on SPA navigation", async () => {
		const h = await mount({ ...BASE_CONFIG, dynamicSuggestions: true });
		await h.settle(0, {
			ok: true,
			body: envelope([{ id: "p1", text: "Pricing Q" }]),
		});
		expect(h.value).toEqual(["Pricing Q"]);

		await h.navigate("/docs/getting-started");
		expect(pending).toHaveLength(2);
		expect(new URL(pending[1].url).searchParams.get("url")).toBe(
			"/docs/getting-started",
		);

		await h.settle(1, {
			ok: true,
			body: envelope([{ id: "d1", text: "Docs Q" }]),
		});
		expect(h.value).toEqual(["Docs Q"]);
		h.unmount();
	});

	test("a late response for the previous page never overwrites the current one", async () => {
		const h = await mount({ ...BASE_CONFIG, dynamicSuggestions: true });
		await h.navigate("/docs");

		// The in-flight request for /pricing was aborted by the navigation.
		expect(pending).toHaveLength(2);
		expect(pending[0].signal?.aborted).toBe(true);

		await h.settle(1, {
			ok: true,
			body: envelope([{ id: "d1", text: "Docs Q" }]),
		});
		expect(h.value).toEqual(["Docs Q"]);

		// /pricing answers late — must be ignored.
		await h.settle(0, {
			ok: true,
			body: envelope([{ id: "p1", text: "Pricing Q" }]),
		});
		expect(h.value).toEqual(["Docs Q"]);
		h.unmount();
	});
});
