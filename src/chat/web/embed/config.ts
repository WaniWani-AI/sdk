// ============================================================================
// Embed Config — types and resolution
// ============================================================================

import type { ChatTheme } from "../@types";

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
	/** Welcome message shown before the first user message. */
	welcomeMessage?: string;
	/** Placeholder text for the input field. */
	placeholder?: string;
	/** Initial suggestion chips displayed before the first message. */
	suggestions?: string[];
	/** URL to a custom stylesheet injected into the shadow root. */
	css?: string;
	/**
	 * Persist conversations across page reloads using IndexedDB so users can
	 * resume previous threads. Defaults to `false` — opt in explicitly.
	 */
	enableThreadHistory?: boolean;
	/**
	 * Theme overrides applied to the chat. Accepts the full `ChatTheme`
	 * surface — pass `DARK_THEME` or any subset of its keys. The script-tag
	 * embed only sets a handful of these from `data-*` attributes, but
	 * programmatic callers (`WaniwaniChat`, `ChatEmbed`) can pass anything.
	 */
	theme?: ChatTheme;
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

	const primaryColor = str("data-primary-color");
	const backgroundColor = str("data-background-color");
	const textColor = str("data-text-color");
	const fontFamily = str("data-font-family");

	if (primaryColor || backgroundColor || textColor || fontFamily) {
		config.theme = {};
		if (primaryColor) {
			config.theme.primaryColor = primaryColor;
		}
		if (backgroundColor) {
			config.theme.backgroundColor = backgroundColor;
		}
		if (textColor) {
			config.theme.textColor = textColor;
		}
		if (fontFamily) {
			config.theme.fontFamily = fontFamily;
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

	const merged: EmbedConfig = {
		token: "",
		...DEFAULTS,
		...compact(remote),
		...compact(fromScript),
		...compact(programmatic),
		theme: {
			...(remote?.theme ?? {}),
			...fromScript.theme,
			...programmatic?.theme,
		},
	};

	if (!merged.token) {
		throw new Error(
			"[WaniWani] Missing required config: `token`. " +
				"Set data-token on the script tag or pass it to WaniWani.chat.init().",
		);
	}

	return merged;
}

// ---------------------------------------------------------------------------
// Theme adapter — EmbedConfig.theme → chat ChatTheme
// ---------------------------------------------------------------------------

export function buildChatTheme(config: EmbedConfig): ChatTheme | undefined {
	if (!config.theme || Object.keys(config.theme).length === 0) {
		return undefined;
	}
	// `config.theme` already conforms to `ChatTheme`. The old implementation
	// hand-picked four keys, which silently dropped every other `DARK_THEME`
	// field (headerBackgroundColor, inputBackgroundColor, assistantBubble…)
	// and rendered a light header/input on top of a dark chat body.
	return config.theme;
}
