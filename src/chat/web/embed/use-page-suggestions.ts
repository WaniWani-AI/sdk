// ============================================================================
// usePageSuggestions — starter prompts for the page the widget sits on.
//
// A channel with page-aware prompts delivers them in `/config` as
// `pageSuggestions` entries keyed by normalized pathname. The widget matches
// its location against those entries locally — no per-page request — and
// re-picks on every SPA navigation (via `usePathname`). Pages with no entry
// (or a channel with none) fall back to the channel's fixed `suggestions` —
// the pills are decoration on the entry point, never a hard dependency.
// ============================================================================

import { useMemo } from "react";
import { debugLog } from "../lib/debug";
import type {
	EmbedConfig,
	PagePrompt,
	PagePromptTier,
	PageSuggestionsEntry,
} from "./config";
import { usePathname } from "./use-pathname";

/**
 * One starter prompt. `id` identifies an authored per-page prompt so a click
 * can be attributed back to it; it is `null` for prompts coming from the
 * channel's fixed `suggestions` list, which have no stored identity. Ids stop
 * at this hook's resolve state — the embeds render texts — parked there so
 * click attribution can pick them up without re-plumbing the resolve.
 */
export interface PageSuggestion {
	id: string | null;
	text: string;
}

/** How many of a page's authored prompts the widget shows at a time. */
const SHOWN_PROMPT_COUNT = 3;

/**
 * Intent tiers in display order: educational / discovery first, action last.
 * One prompt is shown per tier, so a visitor sees a next step for every level
 * of buying intent.
 */
const TIER_ORDER: PagePromptTier[] = ["low", "medium", "high"];

function takeRandom<T>(pool: T[]): T | undefined {
	if (pool.length === 0) {
		return undefined;
	}
	const index = Math.floor(Math.random() * pool.length);
	const [taken] = pool.splice(index, 1);
	return taken;
}

/**
 * Pick up to {@link SHOWN_PROMPT_COUNT} prompts, one per intent tier in
 * {@link TIER_ORDER}. A tier with no tagged prompt borrows from the untagged
 * (wildcard) pool, and any slot still empty is filled from whatever remains —
 * so a page with at least {@link SHOWN_PROMPT_COUNT} stored prompts always
 * shows exactly that many, and an all-untagged pool degrades to a uniform
 * random pick. Random within each pool so exposure spreads across visits.
 */
export function pickPagePrompts(prompts: PagePrompt[]): PagePrompt[] {
	const byTier = new Map<PagePromptTier, PagePrompt[]>();
	const wildcards: PagePrompt[] = [];
	for (const prompt of prompts) {
		if (prompt.tier) {
			const pool = byTier.get(prompt.tier) ?? [];
			pool.push(prompt);
			byTier.set(prompt.tier, pool);
		} else {
			wildcards.push(prompt);
		}
	}

	const picked: PagePrompt[] = [];
	for (const tier of TIER_ORDER) {
		const fromTier = takeRandom(byTier.get(tier) ?? []);
		const choice = fromTier ?? takeRandom(wildcards);
		if (choice) {
			picked.push(choice);
		}
	}

	const leftovers = [...byTier.values()].flat().concat(wildcards);
	while (picked.length < Math.min(SHOWN_PROMPT_COUNT, prompts.length)) {
		const filler = takeRandom(leftovers);
		if (!filler) {
			break;
		}
		picked.push(filler);
	}
	return picked;
}

/**
 * Reduce a URL or pathname to the form `pageSuggestions` entries are keyed
 * by: pathname only, query and hash dropped, no trailing slash (root stays
 * `/`), lowercased. Mirrors the server's authoring-side normalization, so a
 * set authored for `https://site.com/Pricing/` is the one a widget on
 * `/pricing` picks up. Anything unparseable normalizes to `/`.
 */
export function normalizePathname(url: string): string {
	let pathname: string;
	try {
		// A base is required to parse a bare pathname; only the pathname
		// survives, so the base itself is discarded.
		pathname = new URL(url, "http://localhost").pathname;
	} catch {
		pathname = "/";
	}
	const trimmed = pathname.replace(/\/+$/, "");
	return (trimmed === "" ? "/" : trimmed).toLowerCase();
}

/**
 * Validate a `pageSuggestions` value from `/config` into typed entries.
 *
 * Malformed entries and prompts degrade by dropping out rather than throwing —
 * remote config is a convenience layer, never required for the widget to
 * function. An entry left with no usable prompts is dropped whole, so the
 * page it named falls back to the fixed list.
 */
export function parsePageSuggestions(value: unknown): PageSuggestionsEntry[] {
	if (!Array.isArray(value)) {
		return [];
	}
	return value.flatMap((entry): PageSuggestionsEntry[] => {
		const item = entry as {
			url?: unknown;
			prompts?: unknown;
		} | null;
		if (
			typeof item?.url !== "string" ||
			item.url.length === 0 ||
			!Array.isArray(item.prompts)
		) {
			return [];
		}
		const prompts = item.prompts.flatMap((raw): PagePrompt[] => {
			const prompt = raw as Partial<PagePrompt> | null;
			if (typeof prompt?.text !== "string" || prompt.text.length === 0) {
				return [];
			}
			return [
				{
					id: typeof prompt.id === "string" ? prompt.id : null,
					text: prompt.text,
					tier:
						prompt.tier === "low" ||
						prompt.tier === "medium" ||
						prompt.tier === "high"
							? prompt.tier
							: undefined,
				},
			];
		});
		return prompts.length > 0 ? [{ url: item.url, prompts }] : [];
	});
}

/**
 * The list to render: the page's own picked prompts when we have any,
 * otherwise the channel's fixed `suggestions`.
 */
export function resolveSuggestions(
	picked: PageSuggestion[] | null,
	fallback: string[] | undefined,
): PageSuggestion[] {
	if (picked && picked.length > 0) {
		return picked;
	}
	return (fallback ?? []).map((text) => ({ id: null, text }));
}

/**
 * Resolved starter prompt texts for the current page, with a stable array
 * identity between navigations — `useSuggestions` (inside `ChatEmbed`) keys an
 * effect on the `initial` array identity and setStates it, so a fresh array
 * each render would loop. The random per-tier pick happens inside the memo,
 * so one set stays up until the visitor navigates.
 *
 * Inert without `config.pageSuggestions` — against servers that predate the
 * field (or a channel with the feature off, which never receives it) this is
 * exactly `config.suggestions`.
 */
export function usePageSuggestions(config: EmbedConfig): string[] {
	const { pageSuggestions, suggestions } = config;
	// Re-picks on client-side route changes, not just hard loads.
	const pathname = usePathname();

	return useMemo(() => {
		const current = normalizePathname(pathname);
		const page = pageSuggestions?.find(
			(entry) => normalizePathname(entry.url) === current,
		);
		const picked = page
			? pickPagePrompts(page.prompts).map(({ id, text }) => ({ id, text }))
			: null;
		debugLog("page suggestions resolve", {
			pathname: current,
			matched: Boolean(page),
			count: picked?.length ?? 0,
		});
		return resolveSuggestions(picked, suggestions).map((s) => s.text);
	}, [pathname, pageSuggestions, suggestions]);
}
