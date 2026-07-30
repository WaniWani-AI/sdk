import { beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
// Type-only, so it doesn't pull the module in before the globals below exist.
import type { EmbedConfig, PagePrompt } from "../config";

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

const { act, createElement } = await import("react");
const { createRoot } = await import("react-dom/client");
const {
	normalizePathname,
	parsePageSuggestions,
	pickPagePrompts,
	resolveSuggestions,
	usePageSuggestions,
} = await import("../use-page-suggestions");

const PRICING_PROMPTS: PagePrompt[] = [
	{ id: "pricing-1", text: "What plans do you offer?", tier: "low" },
	{ id: "pricing-2", text: "How does per-seat billing work?", tier: "medium" },
	{ id: "pricing-3", text: "Is there a free trial?", tier: "high" },
	{ id: "pricing-4", text: "Can I switch plans mid-cycle?" },
	{ id: "pricing-5", text: "Do you offer annual discounts?" },
	{ id: "pricing-6", text: "What counts as an active user?" },
];

const BASE_CONFIG: EmbedConfig = {
	api: "https://app.waniwani.ai/api/mcp/chat",
	token: "wwp_test",
	channelId: "0b3d5f2e-1c4a-4f8b-9d2e-6a7c8b9d0e1f",
	suggestions: ["Static A", "Static B"],
	pageSuggestions: [
		{ url: "/pricing", prompts: PRICING_PROMPTS },
		{ url: "/docs", prompts: [{ id: "d1", text: "Docs Q", tier: "low" }] },
	],
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

beforeEach(async () => {
	await act(async () => {
		win.history.pushState({}, "", "/pricing");
	});
});

describe("normalizePathname", () => {
	test("keeps a bare pathname and reduces a full URL to one", () => {
		expect(normalizePathname("/pricing")).toBe("/pricing");
		expect(normalizePathname("https://example.com/pricing")).toBe("/pricing");
	});

	test("drops query, hash and trailing slashes; root stays /", () => {
		expect(normalizePathname("/pricing/?utm_source=x#plans")).toBe("/pricing");
		expect(normalizePathname("https://example.com")).toBe("/");
		expect(normalizePathname("/")).toBe("/");
	});

	test("lowercases, so the authored key and the live pathname agree", () => {
		expect(normalizePathname("/Pricing/Plans")).toBe("/pricing/plans");
		expect(normalizePathname("https://Example.com/Pricing/?utm=1")).toBe(
			normalizePathname("/pricing"),
		);
	});
});

describe("pickPagePrompts", () => {
	test("shows exactly one prompt per tier, low → medium → high", () => {
		const tiered = PRICING_PROMPTS.slice(0, 3);
		for (let i = 0; i < 20; i++) {
			const picked = pickPagePrompts([...tiered]);
			expect(picked.map((p) => p.tier)).toEqual(["low", "medium", "high"]);
		}
	});

	test("a tier with no tagged prompt is filled by an untagged wildcard", () => {
		const pool: PagePrompt[] = [
			{ id: "low-1", text: "a", tier: "low" },
			{ id: "high-1", text: "b", tier: "high" },
			{ id: "wild-1", text: "c" },
		];
		for (let i = 0; i < 10; i++) {
			const picked = pickPagePrompts(pool);
			expect(picked.map((p) => p.id).sort()).toEqual([
				"high-1",
				"low-1",
				"wild-1",
			]);
		}
	});

	test("an all-untagged pool keeps the uniform random pick", () => {
		const untagged = PRICING_PROMPTS.slice(3);
		const seen = new Set<string | null>();
		for (let i = 0; i < 40; i++) {
			const picked = pickPagePrompts(untagged);
			expect(picked).toHaveLength(3);
			for (const p of picked) {
				seen.add(p.id);
			}
		}
		expect(seen.size).toBe(untagged.length);
	});

	test("fewer prompts than slots shows what exists", () => {
		expect(
			pickPagePrompts([{ id: "only", text: "One", tier: "high" }]),
		).toHaveLength(1);
	});
});

describe("parsePageSuggestions", () => {
	test("reads well-formed entries, keeping ids and tiers", () => {
		expect(
			parsePageSuggestions([
				{
					url: "/pricing",
					prompts: [{ id: "p1", text: "How much?", tier: "low" }],
				},
			]),
		).toEqual([
			{
				url: "/pricing",
				prompts: [{ id: "p1", text: "How much?", tier: "low" }],
			},
		]);
	});

	test("coerces a non-string id to null and drops an unknown tier", () => {
		const [entry] = parsePageSuggestions([
			{ url: "/a", prompts: [{ id: 7, text: "ok", tier: "urgent" }] },
		]);
		expect(entry.prompts).toEqual([{ id: null, text: "ok", tier: undefined }]);
	});

	test("drops prompts with no usable text, and entries left empty", () => {
		expect(
			parsePageSuggestions([
				{ url: "/a", prompts: [{ id: "x", text: "" }, null] },
				{ url: "/b", prompts: [{ id: "y", text: "kept" }] },
			]),
		).toEqual([{ url: "/b", prompts: [{ id: "y", text: "kept" }] }]);
	});

	test("degrades to [] on malformed values", () => {
		for (const value of [null, undefined, {}, "nope", [{ url: 3 }]]) {
			expect(parsePageSuggestions(value)).toEqual([]);
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

	test("falls back when the page has no entry", () => {
		expect(resolveSuggestions(null, fallback)).toEqual([
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
	test("is inert without pageSuggestions — exactly the fixed list", async () => {
		const h = await mount({ ...BASE_CONFIG, pageSuggestions: undefined });
		expect(h.value).toEqual(["Static A", "Static B"]);
		h.unmount();
	});

	test('suggestionOrigins without "page" gates authored pages off', async () => {
		const h = await mount({
			...BASE_CONFIG,
			suggestionOrigins: ["channel", "followup"],
		});
		expect(h.value).toEqual(["Static A", "Static B"]);
		h.unmount();
	});

	test('suggestionOrigins including "page" keeps them on', async () => {
		const h = await mount({
			...BASE_CONFIG,
			suggestionOrigins: ["channel", "page"],
		});
		expect(h.value).toHaveLength(3);
		h.unmount();
	});

	test("shows three of the current page's prompts, one per tier first", async () => {
		const h = await mount(BASE_CONFIG);
		expect(h.value).toHaveLength(3);
		const texts = PRICING_PROMPTS.map((p) => p.text);
		for (const text of h.value) {
			expect(texts).toContain(text);
		}
		h.unmount();
	});

	test("swaps the pills on SPA navigation and falls back on unseeded pages", async () => {
		const h = await mount(BASE_CONFIG);
		expect(h.value).toHaveLength(3);

		await h.navigate("/docs");
		expect(h.value).toEqual(["Docs Q"]);

		await h.navigate("/blog/hello");
		expect(h.value).toEqual(["Static A", "Static B"]);
		h.unmount();
	});

	test("matches the authored entry regardless of casing or query noise", async () => {
		const h = await mount(BASE_CONFIG);
		await h.navigate("/Docs/?utm_source=x");
		expect(h.value).toEqual(["Docs Q"]);
		h.unmount();
	});

	test("keeps one picked set stable until the visitor navigates", async () => {
		const h = await mount(BASE_CONFIG);
		const first = h.value;
		await h.navigate("/pricing#anchor");
		// Same normalized pathname → same memoized pick, no reshuffle.
		expect(h.value).toEqual(first);
		h.unmount();
	});
});
