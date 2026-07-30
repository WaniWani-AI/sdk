// ============================================================================
// usePageSuggestions — starter prompts for the page the widget sits on.
// `/config` delivers per-page sets (`pageSuggestions`, keyed by normalized
// pathname); the widget matches its location locally and re-picks on SPA
// navigation. Unmatched pages fall back to the fixed `suggestions`.
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
 * One starter prompt. `id` is the authored entry's identity (click
 * attribution later); `null` for prompts from the fixed list.
 */
export interface PageSuggestion {
	id: string | null;
	text: string;
}

/** How many of a page's authored prompts the widget shows at a time. */
const SHOWN_PROMPT_COUNT = 3;

/** Tier display order. One prompt is shown per tier. */
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
 * Pick up to {@link SHOWN_PROMPT_COUNT} prompts, one per tier; untagged
 * prompts fill any slot, leftovers top up short slots. Random within pools.
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
		const choice = takeRandom(byTier.get(tier) ?? []) ?? takeRandom(wildcards);
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
 * URL or pathname → the key `pageSuggestions` entries use: pathname only, no
 * query/hash/trailing slash, lowercased. Mirrors the server's authoring-side
 * normalization; unparseable input becomes `/`.
 */
export function normalizePathname(url: string): string {
	let pathname: string;
	try {
		pathname = new URL(url, "http://localhost").pathname;
	} catch {
		pathname = "/";
	}
	const trimmed = pathname.replace(/\/+$/, "");
	return (trimmed === "" ? "/" : trimmed).toLowerCase();
}

/**
 * Validate a raw `pageSuggestions` value into typed entries. Malformed
 * entries/prompts drop out instead of throwing; an entry left empty is
 * dropped whole.
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

/** The page's picked prompts when there are any, else the fixed fallback. */
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
 * Starter prompt texts for the current page. Memoized so the pick is stable
 * per pathname and the array identity doesn't loop `useSuggestions`' effect.
 * Without `config.pageSuggestions` this is exactly `config.suggestions`.
 */
export function usePageSuggestions(config: EmbedConfig): string[] {
	const { pageSuggestions, suggestions } = config;
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
