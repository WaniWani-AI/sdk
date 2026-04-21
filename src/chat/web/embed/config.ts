// ============================================================================
// Embed Config — types and resolution
// ============================================================================

/**
 * Configuration for the embeddable chat widget.
 *
 * Resolution priority (later wins):
 *   defaults < remote config (from server) < `data-*` attrs < programmatic.
 *
 * Remote config lives on `GET {api}/config` and is authenticated with the
 * embed token. It only carries display-facing fields (title, welcome message,
 * placeholder, suggestions) — system prompt and step budget stay server-side.
 */
export interface EmbedConfig {
	/** WaniWani chat API URL. Defaults to `https://app.waniwani.ai/api/mcp/chat`. */
	api?: string;
	/** Embed token (wwp_...) for authentication (required). */
	token: string;
	/** Override MCP server URL (optional — resolved from environment by default). */
	mcpServerUrl?: string;
	/** CSS selector for inline mode — renders ChatCard inside this element instead of a floating bubble. */
	container?: string;
	/** Title shown in the chat header. Defaults to `"Assistant"`. */
	title?: string;
	/** Welcome message shown before the first user message. */
	welcomeMessage?: string;
	/** Placeholder text for the input field. */
	placeholder?: string;
	/** Initial suggestion chips displayed before the first message. */
	suggestions?: string[];
	/** Position of the floating bubble. Defaults to `"bottom-right"`. */
	position?: "bottom-right" | "bottom-left";
	/** Panel width in pixels. Defaults to `400`. */
	width?: number;
	/** Panel height in pixels. Defaults to `600`. */
	height?: number;
	/** URL to a custom stylesheet injected into the shadow root. */
	css?: string;
	/** Theme overrides applied to the ChatCard. */
	theme?: {
		primaryColor?: string;
		backgroundColor?: string;
		textColor?: string;
		fontFamily?: string;
	};
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_API_URL = "https://app.waniwani.ai/api/mcp/chat";

const DEFAULTS = {
	api: DEFAULT_API_URL,
	title: "Assistant",
	position: "bottom-right" as const,
	width: 400,
	height: 600,
};

// ---------------------------------------------------------------------------
// Script tag detection
// ---------------------------------------------------------------------------

function findScriptTag(): HTMLScriptElement | null {
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

	const num = (attr: string): number | undefined => {
		const raw = el.getAttribute(attr);
		if (raw == null) {
			return undefined;
		}
		const n = Number(raw);
		return Number.isFinite(n) ? n : undefined;
	};

	const config: Partial<EmbedConfig> = {};

	// Required fields
	const api = str("data-api");
	if (api) {
		config.api = api;
	}

	const token = str("data-token");
	if (token) {
		config.token = token;
	}

	// Optional strings
	const container = str("data-container");
	if (container) {
		config.container = container;
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

	const css = str("data-css");
	if (css) {
		config.css = css;
	}

	// Suggestions (comma-separated)
	const suggestionsRaw = str("data-suggestions");
	if (suggestionsRaw) {
		config.suggestions = suggestionsRaw
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean);
	}

	// Position
	const position = str("data-position");
	if (position === "bottom-right" || position === "bottom-left") {
		config.position = position;
	}

	// Dimensions
	const width = num("data-width");
	if (width) {
		config.width = width;
	}

	const height = num("data-height");
	if (height) {
		config.height = height;
	}

	// Theme from individual data attributes
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

export function resolveConfig(
	programmatic?: Partial<EmbedConfig>,
	remote?: Partial<EmbedConfig>,
): EmbedConfig {
	const fromScript = parseConfigFromScript();

	const merged: EmbedConfig = {
		// Required — token validated below, api has default
		token: "",

		// Defaults
		...DEFAULTS,

		// Server-side config (fills in gaps the customer didn't override)
		...(remote ?? {}),

		// Script attributes (override remote + defaults)
		...fromScript,

		// Programmatic (overrides everything)
		...programmatic,

		// Deep-merge theme: defaults < remote < script < programmatic
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
