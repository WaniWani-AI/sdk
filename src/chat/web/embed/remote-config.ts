// ============================================================================
// Remote embed config — fetched from `GET {api}/config` on mount.
//
// Only display-facing fields come over the wire. `systemPrompt` and
// `maxSteps` are inference-time concerns and stay server-side.
// ============================================================================

import { useEffect, useState } from "react";
import type { EmbedConfig } from "./config";
import { resolveConfig } from "./config";

// ---------------------------------------------------------------------------
// Session cache
//
// Keeps the last-seen remote config in `sessionStorage` so a second mount in
// the same tab can render the fully-assembled chrome immediately, with the
// background revalidation updating fields silently if anything changed.
// Session scope auto-expires per tab and is origin-isolated, so we don't
// need an explicit TTL.
// ---------------------------------------------------------------------------

const CACHE_PREFIX = "waniwani:config:";

function cacheKey(
	api: string,
	token: string,
	channelId: string | undefined,
): string {
	return `${CACHE_PREFIX}${api}|${token}|${channelId ?? ""}`;
}

export function loadCachedConfig(
	api: string,
	token: string,
	channelId?: string,
): Partial<EmbedConfig> | null {
	if (typeof window === "undefined") {
		return null;
	}
	try {
		const raw = window.sessionStorage.getItem(cacheKey(api, token, channelId));
		if (!raw) {
			return null;
		}
		const parsed = JSON.parse(raw) as Partial<EmbedConfig>;
		return parsed && typeof parsed === "object" ? parsed : null;
	} catch {
		return null;
	}
}

export function saveCachedConfig(
	api: string,
	token: string,
	channelId: string | undefined,
	config: Partial<EmbedConfig>,
): void {
	if (typeof window === "undefined") {
		return;
	}
	try {
		window.sessionStorage.setItem(
			cacheKey(api, token, channelId),
			JSON.stringify(config),
		);
	} catch {
		// sessionStorage can be disabled (private mode, quota) — silently skip.
	}
}

/**
 * Safety net so a stalled `/config` doesn't leave the chat surface blank
 * forever. After this, render with whatever config we have (programmatic +
 * defaults) even if the fetch is still in flight.
 */
const READINESS_TIMEOUT_MS = 600;

interface RemoteConfigResponse {
	welcomeMessage: string | null;
	title: string | null;
	placeholder: string | null;
	suggestions: string[] | null;
	enableThreadHistory?: boolean | null;
}

/**
 * Fetch the server-side config for a public token. Returns a sparse
 * `Partial<EmbedConfig>` (only keys the server populated) so callers can
 * safely spread it into their config merge.
 *
 * Resolves to `{}` on any network or parse error — remote config is a
 * convenience layer, never required for the widget to function.
 */
export async function fetchRemoteConfig(
	api: string,
	token: string,
	signal?: AbortSignal,
	channelId?: string,
): Promise<Partial<EmbedConfig>> {
	try {
		const base = `${api.replace(/\/$/, "")}/config`;
		const url = channelId
			? `${base}?channel=${encodeURIComponent(channelId)}`
			: base;
		const res = await fetch(url, {
			method: "GET",
			headers: { Authorization: `Bearer ${token}` },
			signal,
		});
		if (!res.ok) {
			return {};
		}
		// The WaniWani API wraps payloads in `{ success, message, data }`.
		// Accept either shape so we stay compatible with raw endpoints too.
		const raw = (await res.json()) as
			| RemoteConfigResponse
			| { success: boolean; data?: RemoteConfigResponse };
		const data: RemoteConfigResponse | null =
			raw && typeof raw === "object" && "data" in raw && raw.data
				? raw.data
				: (raw as RemoteConfigResponse);
		if (!data) {
			return {};
		}
		return remoteToConfigPartial(data);
	} catch {
		return {};
	}
}

function remoteToConfigPartial(
	data: RemoteConfigResponse,
): Partial<EmbedConfig> {
	const out: Partial<EmbedConfig> = {};
	if (data.title != null) {
		out.title = data.title;
	}
	if (data.welcomeMessage != null) {
		out.welcomeMessage = data.welcomeMessage;
	}
	if (data.placeholder != null) {
		out.placeholder = data.placeholder;
	}
	if (data.suggestions != null && data.suggestions.length > 0) {
		out.suggestions = data.suggestions;
	}
	if (typeof data.enableThreadHistory === "boolean") {
		out.enableThreadHistory = data.enableThreadHistory;
	}
	return out;
}

/**
 * Fetch the remote config on mount and return an `EmbedConfig` that
 * re-resolves through the layered merge (defaults < remote < data-attrs <
 * programmatic) once it arrives.
 *
 * Returns `{ config, ready }`. `ready` flips true when the chat surface can
 * be revealed: immediately on a `sessionStorage` cache hit, otherwise after
 * the fetch resolves or a {@link READINESS_TIMEOUT_MS} safety timer fires.
 * Callers gate the first paint on `ready` so the chrome doesn't draw with
 * stale defaults and then snap into the real content.
 *
 * `scriptConfig` must be the same `data-*` snapshot used for the initial
 * resolve. Re-parsing post-fetch is unsafe: `document.currentScript` is
 * null by then and the fallback heuristic can miss the embed script (CDN
 * paths, renamed bundles), silently dropping `data-*` overrides.
 */
export function useRemoteEmbedConfig(
	initialConfig: EmbedConfig,
	programmatic: Partial<EmbedConfig> | undefined,
	scriptConfig: Partial<EmbedConfig> | undefined,
): { config: EmbedConfig; ready: boolean } {
	const [config, setConfig] = useState<EmbedConfig>(() => {
		const { api, token, channelId } = initialConfig;
		if (!api || !token) {
			return initialConfig;
		}
		const cached = loadCachedConfig(api, token, channelId);
		if (!cached) {
			return initialConfig;
		}
		try {
			return resolveConfig(programmatic, cached, scriptConfig);
		} catch {
			return initialConfig;
		}
	});
	const [ready, setReady] = useState<boolean>(() => {
		const { api, token, channelId } = initialConfig;
		if (!api || !token) {
			return true;
		}
		return loadCachedConfig(api, token, channelId) != null;
	});

	// Re-fetching on `programmatic` identity changes would be churn; the
	// caller owns its lifetime — if props change meaningfully they should
	// re-init the widget.
	// biome-ignore lint/correctness/useExhaustiveDependencies: fetch once per api+token
	useEffect(() => {
		const api = initialConfig.api;
		const token = initialConfig.token;
		const channelId = initialConfig.channelId;
		if (!api || !token) {
			setReady(true);
			return;
		}
		const controller = new AbortController();
		const safety = setTimeout(() => setReady(true), READINESS_TIMEOUT_MS);
		void fetchRemoteConfig(api, token, controller.signal, channelId)
			.then((remote) => {
				if (controller.signal.aborted) {
					return;
				}
				if (Object.keys(remote).length > 0) {
					saveCachedConfig(api, token, channelId, remote);
					try {
						setConfig(resolveConfig(programmatic, remote, scriptConfig));
					} catch (err) {
						// `resolveConfig` throws if token is missing. Shouldn't happen
						// here (initial resolve already validated), but swallow so a
						// late failure doesn't become an unhandled rejection.
						console.error("[WaniWani] Failed to apply remote config:", err);
					}
				}
				setReady(true);
			})
			.catch((err) => {
				console.error("[WaniWani] Remote config fetch failed:", err);
				setReady(true);
			})
			.finally(() => clearTimeout(safety));
		return () => {
			controller.abort();
			clearTimeout(safety);
		};
	}, [initialConfig.api, initialConfig.token, initialConfig.channelId]);

	return { config, ready };
}
