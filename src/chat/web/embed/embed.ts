// ============================================================================
// WaniWani Chat Embed — IIFE entry point
//
// Drop a <script> tag with `data-token` on any page; the chat mounts inside
// the first `[data-waniwani-embed]` element on the page, rendered inside a
// shadow DOM for style isolation.
// ============================================================================

import React from "react";
import ReactDOM from "react-dom/client";
import type { EmbedConfig } from "./config";
import { parseConfigFromScript, resolveConfig } from "./config";
import { InlineChat, type InlineChatHandle } from "./inline-chat";

// ---------------------------------------------------------------------------
// CSS placeholder — replaced at build time with the actual CSS string
// ---------------------------------------------------------------------------

const EMBED_CSS = "__WANIWANI_EMBED_CSS__";

// ---------------------------------------------------------------------------
// Global type augmentation
// ---------------------------------------------------------------------------

declare global {
	interface Window {
		WaniWani?: {
			chat?: {
				init: (options?: Partial<EmbedConfig>) => EmbedInstance;
				destroy: () => void;
				/**
				 * Programmatically submit a user message to the chat. No-op if the
				 * embed has not mounted yet or the inner layout has not attached.
				 */
				sendMessage: (text: string) => void;
			};
		};
	}
}

// ---------------------------------------------------------------------------
// Instance tracking
// ---------------------------------------------------------------------------

interface EmbedInstance {
	destroy: () => void;
	sendMessage: (text: string) => void;
}

let currentInstance: EmbedInstance | null = null;
let reactRoot: ReactDOM.Root | null = null;
let hostElement: HTMLElement | null = null;

// ---------------------------------------------------------------------------
// CSS injection helper
// ---------------------------------------------------------------------------

function injectStyles(shadowRoot: ShadowRoot, config: EmbedConfig): void {
	if (EMBED_CSS && EMBED_CSS !== "__WANIWANI_EMBED_CSS__") {
		const style = document.createElement("style");
		style.textContent = EMBED_CSS;
		shadowRoot.appendChild(style);
	}

	if (config.css) {
		try {
			const cssUrl = new URL(config.css, window.location.href);
			if (cssUrl.protocol === "https:" || cssUrl.protocol === "http:") {
				const link = document.createElement("link");
				link.rel = "stylesheet";
				link.href = cssUrl.href;
				shadowRoot.appendChild(link);
			} else {
				console.warn(
					"[WaniWani] Custom CSS URL must use http or https protocol.",
				);
			}
		} catch {
			console.warn("[WaniWani] Invalid custom CSS URL:", config.css);
		}
	}
}

// ---------------------------------------------------------------------------
// Mount
// ---------------------------------------------------------------------------

const INLINE_MARKER_ATTR = "data-waniwani-embed";

function mountInline(
	config: EmbedConfig,
	programmatic: Partial<EmbedConfig> | undefined,
	scriptConfig: Partial<EmbedConfig> | undefined,
): EmbedInstance {
	const container = document.querySelector(`[${INLINE_MARKER_ATTR}]`);
	if (!container) {
		throw new Error(
			`[WaniWani] No inline mount target. Place \`<div ${INLINE_MARKER_ATTR}></div>\` in your page.`,
		);
	}

	// ChatEmbed self-sizes against the customer's container (walking up
	// across the shadow boundary), so the host needs no special sizing —
	// it auto-fits the chat root's chosen height.
	hostElement = document.createElement("div");
	hostElement.id = "waniwani-chat-embed";
	hostElement.style.width = "100%";
	container.appendChild(hostElement);

	const shadowRoot = hostElement.attachShadow({ mode: "open" });
	injectStyles(shadowRoot, config);

	const mountContainer = document.createElement("div");
	shadowRoot.appendChild(mountContainer);

	const inlineRef = React.createRef<InlineChatHandle>();

	reactRoot = ReactDOM.createRoot(mountContainer);
	reactRoot.render(
		React.createElement(InlineChat, {
			ref: inlineRef,
			config,
			programmatic,
			scriptConfig,
		}),
	);

	return {
		destroy: () => {
			reactRoot?.unmount();
			reactRoot = null;
			hostElement?.remove();
			hostElement = null;
			currentInstance = null;
		},
		sendMessage: (text: string) => inlineRef.current?.chat?.sendMessage(text),
	};
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function init(options?: Partial<EmbedConfig>): EmbedInstance {
	if (currentInstance) {
		console.warn(
			"[WaniWani] Chat widget is already initialized. Call destroy() first to re-initialize.",
		);
		return currentInstance;
	}

	// Parse `data-*` once synchronously — `document.currentScript` is only
	// valid during script execution, so we must capture it here and thread
	// the result through to useRemoteEmbedConfig.
	const scriptConfig = parseConfigFromScript();
	const config = resolveConfig(options, undefined, scriptConfig);

	currentInstance = mountInline(config, options, scriptConfig);

	return currentInstance;
}

function destroy(): void {
	if (!currentInstance) {
		return;
	}
	currentInstance.destroy();
}

// ---------------------------------------------------------------------------
// Expose global API
// ---------------------------------------------------------------------------

window.WaniWani = window.WaniWani || {};
window.WaniWani.chat = {
	init,
	destroy,
	sendMessage: (text: string) => currentInstance?.sendMessage(text),
};

// ---------------------------------------------------------------------------
// Auto-init from script tag data attributes
// ---------------------------------------------------------------------------

function autoInit(): void {
	const scriptConfig = parseConfigFromScript();
	if (!scriptConfig.token) {
		return;
	}

	try {
		init();
	} catch (err) {
		console.error("[WaniWani] Auto-initialization failed:", err);
	}
}

if (document.readyState === "loading") {
	document.addEventListener("DOMContentLoaded", autoInit);
} else {
	// DOM is already ready (script loaded with defer/async or injected late)
	autoInit();
}
