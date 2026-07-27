// ============================================================================
// usePageSuggestions — starter prompts for the page the widget sits on.
//
// A channel with `dynamicSuggestions` on authors prompts per URL, so the pills
// should change as the visitor moves around the host site. This fetches them
// from `GET {api}/suggestions` on mount and again on every SPA navigation
// (via `usePathname`), and falls back to the channel's fixed `suggestions`
// whenever the request fails, is unauthorized, or comes back empty — the pills
// are decoration on the entry point, never a hard dependency.
// ============================================================================

import { useEffect, useMemo, useState } from "react";
import { buildApiUrl } from "../lib/api-url";
import { debugLog } from "../lib/debug";
import type { EmbedConfig } from "./config";
import { usePathname } from "./use-pathname";

/**
 * One starter prompt. `id` identifies an authored per-page prompt so a click
 * can be attributed back to it; it is `null` for prompts coming from the
 * channel's fixed `suggestions` list, which have no stored identity. Ids stop
 * at this hook's fetch state — the embeds render texts — parked there so click
 * attribution can pick them up without re-plumbing the fetch.
 */
export interface PageSuggestion {
	id: string | null;
	text: string;
}

/**
 * Pull the prompt list out of a `/suggestions` response body.
 *
 * The Waniwani API wraps payloads in `{ success, message, data }`; a bare
 * `{ suggestions }` root is accepted too so we stay compatible with raw
 * endpoints, matching how `fetchRemoteConfig` unwraps `/config`. Anything
 * malformed degrades to `[]`, which the caller reads as "use the fallback".
 */
export function parseSuggestionsResponse(raw: unknown): PageSuggestion[] {
	const body = raw as {
		data?: { suggestions?: unknown } | null;
		suggestions?: unknown;
	} | null;
	const list = body?.data?.suggestions ?? body?.suggestions;
	if (!Array.isArray(list)) {
		return [];
	}
	return list.flatMap((entry): PageSuggestion[] => {
		const item = entry as Partial<PageSuggestion> | null;
		if (typeof item?.text !== "string" || item.text.length === 0) {
			return [];
		}
		return [
			{ id: typeof item.id === "string" ? item.id : null, text: item.text },
		];
	});
}

/**
 * The list to render: the page's own prompts when we have any, otherwise the
 * channel's fixed `suggestions`. An empty fetched set counts as "nothing
 * authored for this page" and falls back, per the endpoint contract.
 */
export function resolveSuggestions(
	fetched: PageSuggestion[] | null,
	fallback: string[] | undefined,
): PageSuggestion[] {
	if (fetched && fetched.length > 0) {
		return fetched;
	}
	return (fallback ?? []).map((text) => ({ id: null, text }));
}

/**
 * Resolved starter prompt texts for the current page, with a stable array
 * identity between fetches — `useSuggestions` (inside `ChatEmbed`) keys an
 * effect on the `initial` array identity and setStates it, so a fresh array
 * each render would loop.
 *
 * Inert unless the channel reported `dynamicSuggestions: true` — without it
 * (including against servers that predate the flag) this is exactly
 * `config.suggestions`, no request made.
 *
 * `channelId` is required: `/suggestions` takes no environment default and
 * rejects a missing or non-uuid `channel` with a 400, so an embed configured
 * without one stays on the fixed list.
 */
export function usePageSuggestions(config: EmbedConfig): string[] {
	const { api, token, channelId, dynamicSuggestions } = config;
	// Re-runs the fetch on client-side route changes, not just hard loads.
	const pathname = usePathname();
	const [fetched, setFetched] = useState<PageSuggestion[] | null>(null);

	const enabled = Boolean(dynamicSuggestions && api && token && channelId);

	useEffect(() => {
		if (!enabled || !api || !token || !channelId) {
			return;
		}
		// Aborting on cleanup is what keeps a slow response for the page the
		// visitor just left from overwriting the page they are on now.
		const controller = new AbortController();
		void (async () => {
			try {
				const url = buildApiUrl(api, "/suggestions", {
					channel: channelId,
					// The pathname this effect run is for — the server normalizes it,
					// and it is all the host page needs to leak.
					url: pathname,
				});
				const res = await fetch(url, {
					method: "GET",
					headers: { Authorization: `Bearer ${token}` },
					signal: controller.signal,
				});
				const items = res.ok ? parseSuggestionsResponse(await res.json()) : [];
				if (controller.signal.aborted) {
					return;
				}
				debugLog("remote /suggestions response", {
					pathname,
					ok: res.ok,
					count: items.length,
				});
				// `null` rather than `[]` so the resolve below reads it as "no
				// page-specific set" and hands back the channel's fixed list.
				setFetched(items.length > 0 ? items : null);
			} catch {
				// Network error / abort — keep whatever we last resolved to on an
				// abort, otherwise drop back to the fallback.
				if (!controller.signal.aborted) {
					setFetched(null);
				}
			}
		})();
		return () => controller.abort();
	}, [enabled, api, token, channelId, pathname]);

	return useMemo(
		() => resolveSuggestions(fetched, config.suggestions).map((s) => s.text),
		[fetched, config.suggestions],
	);
}
