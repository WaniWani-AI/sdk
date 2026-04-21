// ============================================================================
// Remote embed config — fetched from `GET {api}/config` on mount.
//
// Only display-facing fields come over the wire. `systemPrompt` and
// `maxSteps` are inference-time concerns and stay server-side.
// ============================================================================

import { useEffect, useState } from "react";
import type { EmbedConfig } from "./config";
import { resolveConfig } from "./config";

interface RemoteConfigResponse {
	welcomeMessage: string | null;
	title: string | null;
	placeholder: string | null;
	suggestions: string[] | null;
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
): Promise<Partial<EmbedConfig>> {
	try {
		const url = `${api.replace(/\/$/, "")}/config`;
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
	return out;
}

/**
 * Fetch the remote config on mount and return an `EmbedConfig` that
 * re-resolves through the layered merge (defaults < remote < data-attrs <
 * programmatic) once it arrives. While the request is in flight, returns
 * the initial config untouched.
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
): EmbedConfig {
	const [config, setConfig] = useState(initialConfig);

	// Re-fetching on `programmatic` identity changes would be churn; the
	// caller owns its lifetime — if props change meaningfully they should
	// re-init the widget.
	// biome-ignore lint/correctness/useExhaustiveDependencies: fetch once per api+token
	useEffect(() => {
		const api = initialConfig.api;
		const token = initialConfig.token;
		if (!api || !token) {
			return;
		}
		const controller = new AbortController();
		void fetchRemoteConfig(api, token, controller.signal)
			.then((remote) => {
				if (controller.signal.aborted) {
					return;
				}
				if (Object.keys(remote).length === 0) {
					return;
				}
				try {
					setConfig(resolveConfig(programmatic, remote, scriptConfig));
				} catch (err) {
					// `resolveConfig` throws if token is missing. Shouldn't happen
					// here (initial resolve already validated), but swallow so a
					// late failure doesn't become an unhandled rejection.
					console.error("[WaniWani] Failed to apply remote config:", err);
				}
			})
			.catch((err) => {
				console.error("[WaniWani] Remote config fetch failed:", err);
			});
		return () => controller.abort();
	}, [initialConfig.api, initialConfig.token]);

	return config;
}
