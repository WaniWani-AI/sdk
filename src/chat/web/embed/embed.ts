// ============================================================================
// WaniWani Chat Embed — IIFE entry point
//
// Drop a <script> tag with `data-token` on any page; the chat mounts inside
// the first `[data-waniwani-embed]` element on the page, rendered inside a
// shadow DOM for style isolation.
// ============================================================================

import type { UIMessage } from "ai";
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
				 * Submit a user message to the chat. No-op if the embed has not
				 * mounted yet or the inner layout has not attached.
				 */
				sendMessage: (text: string) => void;
				/**
				 * Submit a user message and resolve with the final assistant
				 * message once streaming completes. Resolves with `undefined`
				 * if the embed has not mounted yet.
				 */
				sendMessageAndWait: (text: string) => Promise<UIMessage | undefined>;
				/** Clear all messages and start a fresh conversation. */
				reset: () => void;
				/** Focus the chat input. */
				focus: () => void;
				/** Snapshot of the current chat messages. Empty until mounted. */
				getMessages: () => UIMessage[];
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
	sendMessageAndWait: (text: string) => Promise<UIMessage | undefined>;
	reset: () => void;
	focus: () => void;
	getMessages: () => UIMessage[];
}

let currentInstance: EmbedInstance | null = null;
let reactRoot: ReactDOM.Root | null = null;
let hostElement: HTMLElement | null = null;
let containerResizeObserver: ResizeObserver | null = null;

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

	// Size the chat against the customer's container in two complementary
	// ways:
	//
	//   1. `height: 100%; max-height: inherit` — works when the customer's
	//      container has a definite height. CSS inheritance reaches across
	//      the shadow boundary via the composed tree.
	//   2. `flex: 1 1 auto; min-height: 0` + `display: flex; flex-direction:
	//      column` — works when the customer's container is a flex column
	//      bounded only by `max-height`. The host fills the flex-resolved
	//      space; declaring the host itself as a flex column lets the chat
	//      root become its flex child, which sidesteps a shadow-DOM quirk
	//      where `height: 100%` on a mount inside the shadow does not
	//      resolve against a flex-sized host. The mount uses `display:
	//      contents` so it drops out of layout entirely.
	//   3. A `ResizeObserver` reflects the container's *maximum* content
	//      area onto the host as an inline `max-height`. `max-height:
	//      inherit` copies the parent's value verbatim, so a `max-height:
	//      800px; padding: 24px; box-sizing: border-box` parent lets the
	//      chat overflow by the padding amount. Recomputing from the
	//      parent's CSS each time it resizes closes that gap. We read
	//      `max-height` / `height` (not the current `contentBoxSize`) to
	//      avoid a feedback loop: when the chat is shorter than the
	//      parent's bound, the parent's content-box shrinks to fit, and
	//      mirroring that would lock the host at its current size.
	hostElement = document.createElement("div");
	hostElement.id = "waniwani-chat-embed";
	hostElement.style.cssText =
		"width:100%;height:100%;max-height:inherit;" +
		"display:flex;flex-direction:column;flex:1 1 auto;min-height:0;";
	container.appendChild(hostElement);

	const host = hostElement;
	const syncMaxHeight = () => {
		const cs = getComputedStyle(container);
		// Only mirror `max-height`. `getComputedStyle().height` returns the
		// resolved size — when the parent is bounded by `max-height` alone
		// and content is shorter, that resolved size shrinks to content,
		// and using it would lock the host below the parent's true bound.
		// When the parent uses an explicit `height`, the existing
		// `height: 100%` chain already resolves correctly against its
		// content box, so we leave the cap unset.
		//
		// Bail unless we get a concrete pixel value: percentages with an
		// indefinite containing block come back as `"80%"`, which would
		// otherwise be parsed as `80` pixels and severely shrink the chat.
		// `max-height: inherit` on the host handles those cases natively.
		if (!cs.maxHeight.endsWith("px")) {
			host.style.removeProperty("max-height");
			return;
		}
		const outer = Number.parseFloat(cs.maxHeight);
		if (!Number.isFinite(outer)) {
			host.style.removeProperty("max-height");
			return;
		}
		let inner = outer;
		if (cs.boxSizing === "border-box") {
			inner -=
				(Number.parseFloat(cs.paddingTop) || 0) +
				(Number.parseFloat(cs.paddingBottom) || 0) +
				(Number.parseFloat(cs.borderTopWidth) || 0) +
				(Number.parseFloat(cs.borderBottomWidth) || 0);
		}
		if (inner > 0) {
			host.style.maxHeight = `${inner}px`;
		} else {
			// Padding + border exceed the parent's `max-height`. Clear any
			// stale override so the host falls back to `max-height: inherit`
			// rather than keeping a value from an earlier observation.
			host.style.removeProperty("max-height");
		}
	};
	syncMaxHeight();
	containerResizeObserver = new ResizeObserver(syncMaxHeight);
	containerResizeObserver.observe(container);

	const shadowRoot = hostElement.attachShadow({ mode: "open" });
	injectStyles(shadowRoot, config);

	const mountContainer = document.createElement("div");
	mountContainer.className = "ww:contents";
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
			containerResizeObserver?.disconnect();
			containerResizeObserver = null;
			reactRoot?.unmount();
			reactRoot = null;
			hostElement?.remove();
			hostElement = null;
			currentInstance = null;
		},
		sendMessage: (text: string) => inlineRef.current?.chat?.sendMessage(text),
		sendMessageAndWait: async (text: string) => {
			const chat = inlineRef.current?.chat;
			if (!chat) {
				return undefined;
			}
			return (await chat.sendMessageAndWait(text)) as UIMessage | undefined;
		},
		reset: () => inlineRef.current?.chat?.reset(),
		focus: () => inlineRef.current?.chat?.focus(),
		getMessages: () => inlineRef.current?.chat?.messages ?? [],
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
	sendMessageAndWait: async (text: string) => {
		if (!currentInstance) {
			return undefined;
		}
		return currentInstance.sendMessageAndWait(text);
	},
	reset: () => currentInstance?.reset(),
	focus: () => currentInstance?.focus(),
	getMessages: () => currentInstance?.getMessages() ?? [],
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
