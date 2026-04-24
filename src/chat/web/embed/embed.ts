// ============================================================================
// WaniWani Chat Embed — IIFE entry point
//
// Drop a <script> tag on any page to get a floating chat bubble or inline
// chat widget, rendered inside a shadow DOM for style isolation.
// ============================================================================

import React from "react";
import ReactDOM from "react-dom/client";
import type { EmbedConfig } from "./config";
import { parseConfigFromScript, resolveConfig } from "./config";
import { FloatingChat, type FloatingChatHandle } from "./floating-chat";
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
				open: () => void;
				close: () => void;
				toggle: () => void;
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
	/** Open the chat panel. No-op in inline mode. */
	open: () => void;
	/** Close the chat panel. No-op in inline mode. */
	close: () => void;
	/** Toggle the chat panel. No-op in inline mode. */
	toggle: () => void;
	/** Submit a user message. No-op until the inner chat layout has mounted. */
	sendMessage: (text: string) => void;
}

let currentInstance: EmbedInstance | null = null;
let reactRoot: ReactDOM.Root | null = null;
let hostElement: HTMLElement | null = null;

// ---------------------------------------------------------------------------
// CSS injection helper
// ---------------------------------------------------------------------------

function injectStyles(shadowRoot: ShadowRoot, config: EmbedConfig): void {
	// Main embed CSS (inlined at build time)
	if (EMBED_CSS && EMBED_CSS !== "__WANIWANI_EMBED_CSS__") {
		const style = document.createElement("style");
		style.textContent = EMBED_CSS;
		shadowRoot.appendChild(style);
	}

	// Custom stylesheet (only allow http/https URLs)
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
// Mount helpers
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
			`[WaniWani] No inline mount target. Place \`<div ${INLINE_MARKER_ATTR}></div>\` in your page for \`mode: "inline"\`.`,
		);
	}

	// Create shadow DOM inside the target container. Stretch to fill the
	// parent so the embedder's sizing (e.g. `h-[640px]`) drives the chat.
	hostElement = document.createElement("div");
	hostElement.id = "waniwani-chat-embed";
	hostElement.style.width = "100%";
	hostElement.style.height = "100%";
	container.appendChild(hostElement);

	const shadowRoot = hostElement.attachShadow({ mode: "open" });
	injectStyles(shadowRoot, config);

	const mountContainer = document.createElement("div");
	mountContainer.style.width = "100%";
	mountContainer.style.height = "100%";
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
		open: () => {},
		close: () => {},
		toggle: () => {},
		sendMessage: (text: string) => inlineRef.current?.chat?.sendMessage(text),
	};
}

function createLoadingSkeleton(
	shadowRoot: ShadowRoot,
	config: EmbedConfig,
): HTMLElement {
	const isLeft = config.position === "bottom-left";
	const primaryColor = config.theme?.primaryColor ?? "#6366f1";

	const skeleton = document.createElement("div");
	skeleton.setAttribute("data-waniwani-skeleton", "");

	// Build DOM programmatically — avoids innerHTML + interpolation so a
	// hostile `primaryColor` (e.g. `red}</style><img onerror=…>`) cannot
	// break out of the CSS context.
	const style = document.createElement("style");
	style.textContent = `
		@keyframes ww-skeleton-pulse { 0%,100% { opacity:1; } 50% { opacity:0.7; } }
		[data-waniwani-skeleton] .ww-sk-bubble {
			position:fixed; bottom:20px; ${isLeft ? "left" : "right"}:20px;
			width:56px; height:56px; border-radius:50%;
			z-index:2147483647;
			animation: ww-skeleton-pulse 1.5s ease-in-out infinite;
		}
	`;
	skeleton.appendChild(style);

	const bubble = document.createElement("div");
	bubble.className = "ww-sk-bubble";
	// Assigning via the CSSStyleDeclaration setter — browser rejects invalid
	// CSS values silently, no string escape hazard.
	bubble.style.backgroundColor = primaryColor;
	skeleton.appendChild(bubble);

	shadowRoot.appendChild(skeleton);
	return skeleton;
}

function mountFloating(
	config: EmbedConfig,
	programmatic: Partial<EmbedConfig> | undefined,
	scriptConfig: Partial<EmbedConfig> | undefined,
): EmbedInstance {
	hostElement = document.createElement("div");
	hostElement.id = "waniwani-chat-embed";
	document.body.appendChild(hostElement);

	const shadowRoot = hostElement.attachShadow({ mode: "open" });

	// Show loading skeleton immediately (CSS-only, no React needed) —
	// skip in custom mode since there's no bubble to stand in for.
	const skeleton =
		config.mode === "custom" ? null : createLoadingSkeleton(shadowRoot, config);

	injectStyles(shadowRoot, config);

	const mountContainer = document.createElement("div");
	shadowRoot.appendChild(mountContainer);

	const chatRef = React.createRef<FloatingChatHandle>();

	reactRoot = ReactDOM.createRoot(mountContainer);
	reactRoot.render(
		React.createElement(FloatingChat, {
			ref: chatRef,
			config,
			programmatic,
			scriptConfig,
			onReady: () => skeleton?.remove(),
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
		open: () => chatRef.current?.open(),
		close: () => chatRef.current?.close(),
		toggle: () => chatRef.current?.toggle(),
		sendMessage: (text: string) => chatRef.current?.chat?.sendMessage(text),
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

	// Pass the raw programmatic overrides + captured script config through
	// so the React-side useRemoteEmbedConfig hook can re-apply them on top
	// of the server's config once it arrives. Without this the remote
	// config could override fields the customer explicitly set.
	currentInstance =
		config.mode === "inline"
			? mountInline(config, options, scriptConfig)
			: mountFloating(config, options, scriptConfig);

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
	open: () => currentInstance?.open(),
	close: () => currentInstance?.close(),
	toggle: () => currentInstance?.toggle(),
	sendMessage: (text: string) => currentInstance?.sendMessage(text),
};

// ---------------------------------------------------------------------------
// Auto-init from script tag data attributes
// ---------------------------------------------------------------------------

function autoInit(): void {
	// Only auto-init if the script tag has data-token set
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
