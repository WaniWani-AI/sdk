// ============================================================================
// Embed Config — types and resolution
// ============================================================================

import type { ChatTheme } from "../@types";
import type { Locale } from "../i18n";

/**
 * Built-in theme presets. `auto` follows the host's `prefers-color-scheme`
 * and switches at runtime without re-rendering.
 */
export type ThemePreset = "light" | "dark" | "auto";

/**
 * Appearance config for the chat widget. Pick a preset and (optionally) layer
 * per-property `variables` on top.
 *
 * ```ts
 * appearance: { theme: "dark", variables: { primaryColor: "#ff6b6b" } }
 * ```
 *
 * The same shape is accepted by the `embed.js` script (`init({ appearance })`),
 * `<WaniwaniChat overrides={{ appearance }} />`, and `<ChatEmbed appearance />`.
 */
export interface ChatAppearance {
	/** Base theme preset. Defaults to `"light"`. */
	theme?: ThemePreset;
	/** Per-property overrides applied on top of the preset. */
	variables?: ChatTheme;
}

/**
 * Configuration for the embeddable chat widget.
 *
 * Resolution priority (later wins):
 *   defaults < remote config (from server) < `data-*` attrs < programmatic.
 *
 * Remote config lives on `GET {api}/config` and is authenticated with the
 * public token. It only carries display-facing fields (title, welcome message,
 * placeholder, suggestions) — system prompt and step budget stay server-side.
 */
export interface EmbedConfig {
	/** WaniWani chat API URL. Defaults to `https://app.waniwani.ai/api/mcp/chat`. */
	api?: string;
	/** Public token (wwp_...) for authentication (required). */
	token: string;
	/** Override MCP server URL (optional — resolved from environment by default). */
	mcpServerUrl?: string;
	/**
	 * Agent channel ID. Sent to the chat API so the WaniWani app routes the
	 * conversation to the right agent. Surfaced as `data-channel-id` on the
	 * embed script tag.
	 */
	channelId?: string;
	/**
	 * Show tool call details (request/response panels) in the chat.
	 *
	 * When `false`, each tool call still renders a compact indicator so the
	 * user can tell the agent is doing something, but the JSON request and
	 * response panels are hidden. Defaults to `true`.
	 *
	 * Surfaced as `data-show-tool-calls` on the embed script tag.
	 */
	showToolCalls?: boolean;
	/** Title shown in the chat header. Defaults to `"Assistant"`. */
	title?: string;
	/**
	 * Force-hide the sticky header even when `title` or `enableThreadHistory`
	 * would otherwise show it. Useful when the host page already provides its
	 * own chrome. Surfaced as `data-hide-header` on the embed script tag.
	 */
	hideHeader?: boolean;
	/** Welcome message shown before the first user message. */
	welcomeMessage?: string;
	/** Placeholder text for the input field. */
	placeholder?: string;
	/** Initial suggestion chips displayed before the first message. */
	suggestions?: string[];
	/**
	 * AI transparency notice rendered under the input (EU AI Act compliance).
	 * String overrides the default wording; `false` hides it. Surfaced as
	 * `data-disclaimer` on the embed script tag (use `data-disclaimer="false"`
	 * to hide).
	 */
	disclaimer?: string | false;
	/** URL to a custom stylesheet injected into the shadow root. */
	css?: string;
	/**
	 * Persist conversations across page reloads using IndexedDB so users can
	 * resume previous threads. Defaults to `false` — opt in explicitly.
	 */
	enableThreadHistory?: boolean;
	/**
	 * Theme preset + per-property overrides. The script tag exposes the
	 * preset via `data-theme="light|dark|auto"`; programmatic callers can
	 * additionally pass `variables` to tweak individual colours.
	 */
	appearance?: ChatAppearance;
	/**
	 * UI language for built-in labels (placeholders, status text, buttons).
	 * One of `"en"`, `"fr"`, `"es"`. When omitted, the widget detects the
	 * locale from `<html lang>` / `navigator.language` and falls back to
	 * English. Surfaced as `data-locale` on the embed script tag.
	 */
	locale?: Locale;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_API_URL = "https://app.waniwani.ai/api/mcp/chat";

const DEFAULTS = {
	api: DEFAULT_API_URL,
};

// ---------------------------------------------------------------------------
// Script tag detection
// ---------------------------------------------------------------------------

function findScriptTag(): HTMLScriptElement | null {
	if (typeof document === "undefined") {
		return null;
	}

	// Preferred: works in synchronous execution during script load
	if (document.currentScript instanceof HTMLScriptElement) {
		return document.currentScript;
	}

	// Fallback: find by src containing "embed"
	const scripts = document.querySelectorAll("script[src]");
	for (const script of scripts) {
		if (script instanceof HTMLScriptElement && /embed/i.test(script.src)) {
			return script;
		}
	}

	return null;
}

// ---------------------------------------------------------------------------
// Parse data-* attributes from the script element
// ---------------------------------------------------------------------------

export function parseConfigFromScript(): Partial<EmbedConfig> {
	const el = findScriptTag();
	if (!el) {
		return {};
	}

	const str = (attr: string): string | undefined =>
		el.getAttribute(attr) ?? undefined;

	const bool = (attr: string): boolean | undefined => {
		const raw = el.getAttribute(attr);
		if (raw == null) {
			return undefined;
		}
		const lowered = raw.trim().toLowerCase();
		if (lowered === "true" || lowered === "1" || lowered === "") {
			return true;
		}
		if (lowered === "false" || lowered === "0") {
			return false;
		}
		return undefined;
	};

	const config: Partial<EmbedConfig> = {};

	const api = str("data-api");
	if (api) {
		config.api = api;
	}

	const token = str("data-token");
	if (token) {
		config.token = token;
	}

	const title = str("data-title");
	if (title) {
		config.title = title;
	}

	const welcomeMessage = str("data-welcome-message");
	if (welcomeMessage) {
		config.welcomeMessage = welcomeMessage;
	}

	const placeholder = str("data-placeholder");
	if (placeholder) {
		config.placeholder = placeholder;
	}

	const mcpServerUrl = str("data-mcp-server-url");
	if (mcpServerUrl) {
		config.mcpServerUrl = mcpServerUrl;
	}

	const channelId = str("data-channel-id");
	if (channelId) {
		config.channelId = channelId;
	}

	const showToolCalls = bool("data-show-tool-calls");
	if (showToolCalls !== undefined) {
		config.showToolCalls = showToolCalls;
	}

	const css = str("data-css");
	if (css) {
		config.css = css;
	}

	const suggestionsRaw = str("data-suggestions");
	if (suggestionsRaw) {
		config.suggestions = suggestionsRaw
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean);
	}

	const enableThreadHistory = bool("data-enable-thread-history");
	if (enableThreadHistory !== undefined) {
		config.enableThreadHistory = enableThreadHistory;
	}

	const hideHeader = bool("data-hide-header");
	if (hideHeader !== undefined) {
		config.hideHeader = hideHeader;
	}

	const themeRaw = str("data-theme");
	if (themeRaw === "light" || themeRaw === "dark" || themeRaw === "auto") {
		config.appearance = { theme: themeRaw };
	}

	const localeRaw = str("data-locale");
	if (localeRaw === "en" || localeRaw === "fr" || localeRaw === "es") {
		config.locale = localeRaw;
	}

	const disclaimerRaw = str("data-disclaimer");
	if (disclaimerRaw !== undefined) {
		const trimmed = disclaimerRaw.trim();
		const lowered = trimmed.toLowerCase();
		if (lowered === "false" || lowered === "0") {
			config.disclaimer = false;
		} else if (trimmed) {
			config.disclaimer = trimmed;
		}
	}

	return config;
}

// ---------------------------------------------------------------------------
// Merge: defaults < remote < script attrs < programmatic
// ---------------------------------------------------------------------------

/**
 * Drop keys whose value is `undefined` so a spread doesn't overwrite an
 * already-resolved value with nothing. Callers (notably `WaniwaniChat`)
 * build `programmatic` by reading `overrides?.welcomeMessage` etc. — every
 * unset override comes out as `{welcomeMessage: undefined, …}` and the
 * trailing `...programmatic` would otherwise blow away values from earlier
 * layers (defaults / remote / script).
 */
function compact<T extends object>(obj: T | undefined): Partial<T> {
	if (!obj) {
		return {};
	}
	const out: Partial<T> = {};
	for (const key in obj) {
		if (obj[key] !== undefined) {
			out[key] = obj[key];
		}
	}
	return out;
}

export function resolveConfig(
	programmatic?: Partial<EmbedConfig>,
	remote?: Partial<EmbedConfig>,
	scriptConfig?: Partial<EmbedConfig>,
): EmbedConfig {
	// Caller may pass a pre-parsed script config so async re-resolution
	// (post-fetch) doesn't re-invoke `parseConfigFromScript` — by the time a
	// promise settles, `document.currentScript` is null and the fallback
	// heuristic can miss renamed/CDN-hosted bundles, silently dropping
	// `data-*` overrides.
	const fromScript = scriptConfig ?? parseConfigFromScript();

	const appearance = mergeAppearance(remote, fromScript, programmatic);

	const merged: EmbedConfig = {
		token: "",
		...DEFAULTS,
		...compact(remote),
		...compact(fromScript),
		...compact(programmatic),
		...(appearance ? { appearance } : {}),
	};

	if (!merged.token) {
		throw new Error(
			"[WaniWani] Missing required config: `token`. " +
				"Set data-token on the script tag or pass it to WaniWani.chat.init().",
		);
	}

	return merged;
}

function mergeAppearance(
	remote: Partial<EmbedConfig> | undefined,
	fromScript: Partial<EmbedConfig>,
	programmatic: Partial<EmbedConfig> | undefined,
): ChatAppearance | undefined {
	const theme =
		programmatic?.appearance?.theme ??
		fromScript.appearance?.theme ??
		remote?.appearance?.theme;
	const variables: ChatTheme = {
		...(remote?.appearance?.variables ?? {}),
		...(fromScript.appearance?.variables ?? {}),
		...(programmatic?.appearance?.variables ?? {}),
	};
	const hasVars = Object.keys(variables).length > 0;
	if (!theme && !hasVars) {
		return undefined;
	}
	const out: ChatAppearance = {};
	if (theme) {
		out.theme = theme;
	}
	if (hasVars) {
		out.variables = variables;
	}
	return out;
}
