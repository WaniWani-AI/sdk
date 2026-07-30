import { useMemo } from "react";
import { DEFAULT_SUGGESTION_ORIGINS } from "../hooks/use-suggestions";
import { debugLog } from "../lib/debug";
import type {
	EmbedConfig,
	PagePrompt,
	PagePromptTier,
	PageSuggestionsEntry,
} from "./config";
import { usePathname } from "./use-pathname";

/** One starter prompt; `id` is null for fixed-list prompts (no stored identity). */
export interface PageSuggestion {
	id: string | null;
	text: string;
}

/** How many of a page's prompts the widget shows at a time. */
const SHOWN_PROMPT_COUNT = 3;

/** Tier display order; one prompt is shown per tier. */
const TIER_ORDER: PagePromptTier[] = ["low", "medium", "high"];

function takeRandom<T>(pool: T[]): T | undefined {
	if (pool.length === 0) {
		return undefined;
	}
	const index = Math.floor(Math.random() * pool.length);
	const [taken] = pool.splice(index, 1);
	return taken;
}

/** Up to {@link SHOWN_PROMPT_COUNT} prompts, one per tier, random within pools;
 *  untagged prompts fill any slot and leftovers top up short slots. */
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

/** URL → entry key: pathname only, lowercased, no query/hash/trailing slash. */
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

/** Validate a raw `pageSuggestions` value; malformed entries drop out. */
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

/** Starter prompt texts for the current page, else `config.suggestions`.
 *  @param config the resolved embed config (`pageSuggestions` opts in). */
export function usePageSuggestions(config: EmbedConfig): string[] {
	const { pageSuggestions, suggestions, suggestionOrigins } = config;
	const pathname = usePathname();
	const pageEnabled = (
		suggestionOrigins ?? DEFAULT_SUGGESTION_ORIGINS
	).includes("page");

	// Memoized because the pick is random and the identity has to hold:
	// `useSuggestions` keys an effect on this array and setStates it.
	return useMemo(() => {
		const current = normalizePathname(pathname);
		const page = pageEnabled
			? pageSuggestions?.find(
					(entry) => normalizePathname(entry.url) === current,
				)
			: undefined;
		const picked = page
			? pickPagePrompts(page.prompts).map(({ id, text }) => ({ id, text }))
			: null;
		debugLog("page suggestions resolve", {
			pathname: current,
			matched: Boolean(page),
			count: picked?.length ?? 0,
		});
		return resolveSuggestions(picked, suggestions).map((s) => s.text);
	}, [pathname, pageEnabled, pageSuggestions, suggestions]);
}
