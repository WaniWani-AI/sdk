// ============================================================================
// WaniWani Chat Embed — IIFE entry point
//
// Drop a <script> tag on any page to get a floating chat bubble or inline
// chat widget, rendered inside a shadow DOM for style isolation.
// ============================================================================

import React from "react";
import ReactDOM from "react-dom/client";
import { ChatCard } from "../layouts/chat-card";
import type { EmbedConfig } from "./config";
import { parseConfigFromScript, resolveConfig } from "./config";
import { buildChatTheme, FloatingChat } from "./floating-chat";

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
			};
		};
	}
}

// ---------------------------------------------------------------------------
// Instance tracking
// ---------------------------------------------------------------------------

interface EmbedInstance {
	destroy: () => void;
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

function mountInline(config: EmbedConfig): EmbedInstance {
	const selector = config.container as string;
	const container = document.querySelector(selector);
	if (!container) {
		throw new Error(
			`[WaniWani] Container element not found: ${config.container}`,
		);
	}

	// Create shadow DOM inside the target container
	hostElement = document.createElement("div");
	hostElement.id = "waniwani-chat-embed";
	container.appendChild(hostElement);

	const shadowRoot = hostElement.attachShadow({ mode: "open" });
	injectStyles(shadowRoot, config);

	const mountContainer = document.createElement("div");
	mountContainer.style.width = "100%";
	mountContainer.style.height = "100%";
	shadowRoot.appendChild(mountContainer);

	reactRoot = ReactDOM.createRoot(mountContainer);
	reactRoot.render(
		React.createElement(ChatCard, {
			api: config.api,
			headers: { Authorization: `Bearer ${config.token}` },
			skipRemoteConfig: true,
			body: config.mcpServerUrl
				? { mcpServerUrl: config.mcpServerUrl }
				: undefined,
			theme: buildChatTheme(config),
			title: config.title ?? "Assistant",
			welcomeMessage: config.welcomeMessage,
			placeholder: config.placeholder,
			suggestions: config.suggestions
				? { initial: config.suggestions }
				: undefined,
			width: "100%",
			height: "100%",
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

function mountFloating(config: EmbedConfig): EmbedInstance {
	hostElement = document.createElement("div");
	hostElement.id = "waniwani-chat-embed";
	document.body.appendChild(hostElement);

	const shadowRoot = hostElement.attachShadow({ mode: "open" });

	// Show loading skeleton immediately (CSS-only, no React needed)
	const skeleton = createLoadingSkeleton(shadowRoot, config);

	injectStyles(shadowRoot, config);

	const mountContainer = document.createElement("div");
	shadowRoot.appendChild(mountContainer);

	reactRoot = ReactDOM.createRoot(mountContainer);
	reactRoot.render(
		React.createElement(FloatingChat, {
			config,
			onReady: () => skeleton.remove(),
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

	const config = resolveConfig(options);

	currentInstance = config.container
		? mountInline(config)
		: mountFloating(config);

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
window.WaniWani.chat = { init, destroy };

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
