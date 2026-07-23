// ============================================================================
// Waniwani Chat Embed — IIFE entry point
//
// Drop a <script> tag with `data-token` on any page; the chat mounts inside
// the first `[data-waniwani-embed]` element on the page, rendered inside a
// shadow DOM for style isolation.
// ============================================================================

import type { UIMessage } from "ai";
import React from "react";
import ReactDOM from "react-dom/client";
import type { TrackFn, TrackInput } from "../../../tracking/@types";
import {
	createChatTrackClient,
	createNoopChatTrackClient,
} from "../lib/chat-track";
import type { EmbedConfig } from "./config";
import {
	DEFAULT_EMBED_HEIGHT,
	findScriptTag,
	parseConfigFromScript,
	resolveConfig,
} from "./config";
import { FloatingChat, type FloatingChatHandle } from "./floating-chat";
import { InlineChat, type InlineChatHandle } from "./inline-chat";
import { loadCachedConfig } from "./remote-config";
import { isVisibleForPath } from "./visibility";

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
				/** Open the floating panel. No-op in inline mode. */
				open: () => void;
				/** Close the floating panel. No-op in inline mode. */
				close: () => void;
				/** Toggle the floating panel. No-op in inline mode. */
				toggle: () => void;
				/**
				 * Submit a user message to the chat. No-op if the embed has not
				 * mounted yet or the inner layout has not attached. In floating
				 * mode this also opens the panel.
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
				/** Session ID for event correlation. Undefined until the first message. */
				getSessionId: () => string | undefined;
				/**
				 * Track a funnel event from the host page, with the chat session
				 * attached automatically. Same surface as the server client:
				 * `track({ event, properties })` plus the flat revenue helpers
				 * (`track.converted({ amount, currency })`, ...).
				 */
				track: TrackFn;
				/** Tie the visitor to a stable user id (emits `user.identified`). */
				identify: (
					userId: string,
					traits?: Record<string, unknown>,
				) => Promise<{ eventId: string }>;
			};
		};
	}
}

// ---------------------------------------------------------------------------
// Instance tracking
// ---------------------------------------------------------------------------

interface EmbedInstance {
	destroy: () => void;
	open: () => void;
	close: () => void;
	toggle: () => void;
	sendMessage: (text: string) => void;
	sendMessageAndWait: (text: string) => Promise<UIMessage | undefined>;
	reset: () => void;
	focus: () => void;
	getMessages: () => UIMessage[];
	getSessionId: () => string | undefined;
	/** Track a funnel event with the chat session attached automatically. */
	track: TrackFn;
	/** Tie the visitor to a stable user id (emits `user.identified`). */
	identify: (
		userId: string,
		traits?: Record<string, unknown>,
	) => Promise<{ eventId: string }>;
}

/** What the mount functions return; `init()` adds the tracking surface. */
type MountedEmbed = Omit<EmbedInstance, "track" | "identify">;

let currentInstance: EmbedInstance | null = null;
let reactRoot: ReactDOM.Root | null = null;
let hostElement: HTMLElement | null = null;
let containerResizeObserver: ResizeObserver | null = null;

// ---------------------------------------------------------------------------
// Container defaults — injected into the light DOM so customers can override
// with normal CSS specificity.
// ---------------------------------------------------------------------------

const SIZING_STYLE_ID = "waniwani-chat-sizing";
const STRUCTURAL_STYLE_ID = "waniwani-chat-defaults";
const CHROME_STYLE_ID = "waniwani-chat-chrome";
const AUTO_CARD_STYLE_ID = "waniwani-chat-auto-card";

// Sizing default — always injected for inline embeds so a bare
// `<div data-waniwani-embed>` (or the one we auto-create) is bounded out of
// the box instead of growing with content. `:where()` keeps specificity at
// 0, so *any* author rule wins: `[data-waniwani-embed]{height:400px}`,
// `max-height`, a flex/grid track, or `height:auto` to go fully fluid.
// `data-height` sets it explicitly via an inline style (see `mountInline`).
const SIZING_DEFAULTS_CSS = `:where([data-waniwani-embed]){height:${DEFAULT_EMBED_HEIGHT}}`;

// Card-shape defaults — applied only when a preset is chosen. Without one,
// we touch nothing on the customer's container so they keep their own
// shape. `:where()` keeps specificity at 0 so any normal customer selector
// wins (e.g. `border-radius: 0` to opt out of the rounding).
// No `background` here on purpose: the inner chat draws its own background
// via `--ww-color-background`, which switches with the active preset
// (light/dark/auto). Setting a light background here would show through
// any rounded-corner gap in dark mode.
const STRUCTURAL_DEFAULTS_CSS = `:where([data-waniwani-embed]){border-radius:16px;overflow:hidden}`;

// Chrome defaults (border, shadow). Always injected because the vars
// default to no-op values — invisible until the customer passes
// `appearance.variables.borderWidth` / `boxShadow` (bridged onto the
// container by `applyContainerAppearance`) or sets `--ww-*` themselves.
// Lives on the container (not the chat root) because the container's
// `overflow:hidden` would clip a shadow drawn inside.
const CONTAINER_CHROME_CSS = `:where([data-waniwani-embed]){border-style:solid;border-width:var(--ww-border-width,0);border-color:var(--ww-border,transparent);box-shadow:var(--ww-shadow,none)}`;

// Card defaults for the container *we* auto-create (marked `data-waniwani-auto`).
// When the customer placed their own `[data-waniwani-embed]`, we respect their
// layout — but a container we inject has no styling of its own, and a bare
// block div would stretch full-width. So we present it as a centered, rounded
// card with a subtle border + shadow. Injected after `CONTAINER_CHROME_CSS`
// so its (equal-specificity) `:where()` border/shadow win, while still using
// the same `--ww-*` vars so customer `appearance.variables` override them.
// `:where()` => any author rule targeting `[data-waniwani-embed]` still wins.
const AUTO_CARD_CSS = `:where([data-waniwani-embed][data-waniwani-auto]){width:100%;max-width:28rem;margin-inline:auto;border-radius:16px;overflow:hidden;border-style:solid;border-width:var(--ww-border-width,1px);border-color:var(--ww-border,rgba(0,0,0,0.1));box-shadow:var(--ww-shadow,0 10px 30px rgba(0,0,0,0.08))}`;

function ensureStyle(id: string, css: string): void {
	if (typeof document === "undefined" || document.getElementById(id)) {
		return;
	}
	const style = document.createElement("style");
	style.id = id;
	style.textContent = css;
	document.head.appendChild(style);
}

// Mirror the container-level appearance vars onto the customer's container
// element. The chat root inside a shadow root can't push CSS vars back up to
// light DOM, so border + shadow live on the container itself. Only the few
// vars that actually affect the container are bridged — colors etc. stay
// scoped to the chat root.
function applyContainerAppearance(
	container: Element,
	config: EmbedConfig,
): void {
	const vars = config.appearance?.variables;
	if (!vars || !(container instanceof HTMLElement)) {
		return;
	}
	if (typeof vars.borderWidth === "number") {
		container.style.setProperty("--ww-border-width", `${vars.borderWidth}px`);
	}
	if (vars.borderColor) {
		container.style.setProperty("--ww-border", vars.borderColor);
	}
	if (vars.boxShadow) {
		container.style.setProperty("--ww-shadow", vars.boxShadow);
	}
}

// ---------------------------------------------------------------------------
// Shadow-root CSS injection
// ---------------------------------------------------------------------------

function injectStyles(shadowRoot: ShadowRoot, config: EmbedConfig): void {
	if (EMBED_CSS && EMBED_CSS !== "__WANIWANI_EMBED_CSS__") {
		const style = document.createElement("style");
		style.textContent = EMBED_CSS;
		shadowRoot.appendChild(style);
	}

	// In the embed.js path the outer `[data-waniwani-embed]` container draws
	// panel border + shadow (see `CONTAINER_CHROME_CSS`). CSS variables
	// inherit through the shadow boundary, so without this reset the chat
	// root's own chrome rule (`border-width: var(--ww-border-width, 0)`)
	// would render the same border/shadow again — visibly doubling them.
	// Two key properties of this fix:
	//   - It lives in the shadow root only, so the React paths
	//     (`<WaniwaniChat>`, `<ChatEmbed>`) still draw chrome on the chat
	//     root (the React surfaces have no outer container to delegate to).
	//   - It zeroes `border-width` / `box-shadow` directly. The chat root
	//     has no inline `border-width` (only `--ww-border-width` as a
	//     custom property), so a later same-specificity rule wins by
	//     cascade order — no `!important` and no JS-side list of
	//     "container vars" to keep in sync.
	const chromeReset = document.createElement("style");
	chromeReset.textContent =
		"[data-waniwani-chat]{border-width:0;box-shadow:none}";
	shadowRoot.appendChild(chromeReset);

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
					"[Waniwani] Custom CSS URL must use http or https protocol.",
				);
			}
		} catch {
			console.warn("[Waniwani] Invalid custom CSS URL:", config.css);
		}
	}
}

// ---------------------------------------------------------------------------
// Mount
// ---------------------------------------------------------------------------

const INLINE_MARKER_ATTR = "data-waniwani-embed";
// Marks a container we created (vs. one the customer placed). Drives the
// centered-card defaults so an auto-injected container doesn't render as a
// bare full-width block.
const AUTO_MARKER_ATTR = "data-waniwani-auto";

// Find the inline mount target, creating one if the page has none. A bare
// snippet (just the `<script>` tag, no markup) then works out of the box:
// we insert `<div data-waniwani-embed>` immediately before the script so the
// chat mounts where the tag sits. Falls back to `document.body` when the
// script lives in `<head>` (a div there would never render) or can't be
// located.
function ensureInlineContainer(scriptEl: HTMLScriptElement | null): Element {
	const existing = document.querySelector(`[${INLINE_MARKER_ATTR}]`);
	if (existing) {
		return existing;
	}
	const container = document.createElement("div");
	container.setAttribute(INLINE_MARKER_ATTR, "");
	// Tag it as ours so `AUTO_CARD_CSS` applies (centered rounded card).
	container.setAttribute(AUTO_MARKER_ATTR, "");
	const inHead = scriptEl ? !!document.head?.contains(scriptEl) : false;
	if (scriptEl?.parentNode && !inHead) {
		scriptEl.parentNode.insertBefore(container, scriptEl);
	} else {
		document.body.appendChild(container);
	}
	return container;
}

// Normalize a `data-height` value: a bare number is treated as pixels,
// any other CSS length (`"80vh"`, `"600px"`, …) is passed through.
function normalizeHeight(value: string): string {
	return /^\d+$/.test(value.trim()) ? `${value.trim()}px` : value.trim();
}

function mountInline(
	config: EmbedConfig,
	programmatic: Partial<EmbedConfig> | undefined,
	scriptConfig: Partial<EmbedConfig> | undefined,
	scriptEl: HTMLScriptElement | null,
): MountedEmbed {
	const container = ensureInlineContainer(scriptEl);

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

	// A default height so the embed is bounded out of the box (see
	// `SIZING_DEFAULTS_CSS`). `:where()` => any author CSS wins; `data-height`
	// sets it explicitly via an inline style, which beats the `:where()`
	// default without `!important`.
	ensureStyle(SIZING_STYLE_ID, SIZING_DEFAULTS_CSS);
	if (config.height && container instanceof HTMLElement) {
		container.style.height = normalizeHeight(config.height);
	}

	// Card shape (`border-radius`, `overflow`) is opt-in via `data-theme` /
	// `appearance.theme`. Without a preset, we leave the container's shape
	// alone. When opted in, the rule is wrapped in `:where()` so any customer
	// override on `[data-waniwani-embed]` still wins.
	if (config.appearance?.theme) {
		ensureStyle(STRUCTURAL_STYLE_ID, STRUCTURAL_DEFAULTS_CSS);
	}
	ensureStyle(CHROME_STYLE_ID, CONTAINER_CHROME_CSS);
	// A container we created presents as a centered rounded card. Injected
	// after the chrome rule so its border/shadow defaults win (both `:where()`,
	// equal specificity → source order decides).
	if (container.hasAttribute(AUTO_MARKER_ATTR)) {
		ensureStyle(AUTO_CARD_STYLE_ID, AUTO_CARD_CSS);
	}
	applyContainerAppearance(container, config);

	hostElement = document.createElement("div");
	hostElement.id = "waniwani-chat-embed";
	// Structural sizing only. `min-height: 0` is the flex-shrink unblocker:
	// when the customer's container is a flex column, this lets the host
	// (and the chat inside it) shrink below content size instead of
	// expanding the parent. The default height (500px) lives on the
	// container itself (see `SIZING_DEFAULTS_CSS`), not here.
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

	// Collapse the container (which we own, outside React) on gated pages so it
	// shows no empty card. Pre-hide synchronously from the sessionStorage cache
	// so repeat visits to a gated page don't flash before the fetch resolves;
	// `onVisibilityChange` then keeps it in sync (incl. SPA route changes).
	const toggleContainer = (vis: boolean) => {
		if (container instanceof HTMLElement) {
			container.style.display = vis ? "" : "none";
		}
	};
	if (config.token) {
		const cached = loadCachedConfig(
			config.api ?? "",
			config.token,
			config.channelId,
		);
		if (
			cached?.visibility &&
			!isVisibleForPath(cached.visibility, window.location.pathname)
		) {
			toggleContainer(false);
		}
	}

	reactRoot = ReactDOM.createRoot(mountContainer);
	reactRoot.render(
		React.createElement(InlineChat, {
			ref: inlineRef,
			config,
			programmatic,
			scriptConfig,
			onVisibilityChange: toggleContainer,
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
			// Remove the container too, but only if WE created it — leave any
			// author-placed `[data-waniwani-embed]` element in the page so
			// `destroy()` doesn't strip the host's own markup.
			if (container.hasAttribute(AUTO_MARKER_ATTR)) {
				container.remove();
			}
			currentInstance = null;
		},
		// Inline mode has no panel to open — these are no-ops so the public
		// API is uniform across modes.
		open: () => {},
		close: () => {},
		toggle: () => {},
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
		getSessionId: () => inlineRef.current?.chat?.sessionId,
	};
}

// ---------------------------------------------------------------------------
// Mount — floating
// ---------------------------------------------------------------------------

function mountFloating(
	config: EmbedConfig,
	programmatic: Partial<EmbedConfig> | undefined,
	scriptConfig: Partial<EmbedConfig> | undefined,
): MountedEmbed {
	// A viewport-sized, click-through overlay appended to <body>. The launcher
	// and panel inside set `pointer-events: auto`, so the host page stays
	// interactive everywhere else. No `[data-waniwani-embed]` element needed.
	hostElement = document.createElement("div");
	hostElement.id = "waniwani-chat-embed";
	hostElement.style.cssText =
		"position:fixed;inset:0;z-index:2147483000;pointer-events:none;";
	document.body.appendChild(hostElement);

	const shadowRoot = hostElement.attachShadow({ mode: "open" });
	injectStyles(shadowRoot, config);

	const mountContainer = document.createElement("div");
	mountContainer.className = "ww:contents";
	shadowRoot.appendChild(mountContainer);

	const floatingRef = React.createRef<FloatingChatHandle>();

	reactRoot = ReactDOM.createRoot(mountContainer);
	reactRoot.render(
		React.createElement(FloatingChat, {
			ref: floatingRef,
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
		open: () => floatingRef.current?.open(),
		close: () => floatingRef.current?.close(),
		toggle: () => floatingRef.current?.toggle(),
		sendMessage: (text: string) => floatingRef.current?.sendMessage(text),
		sendMessageAndWait: async (text: string) => {
			if (!floatingRef.current) {
				return undefined;
			}
			return floatingRef.current.sendMessageAndWait(text);
		},
		reset: () => floatingRef.current?.reset(),
		focus: () => floatingRef.current?.focus(),
		getMessages: () => floatingRef.current?.getMessages() ?? [],
		getSessionId: () => floatingRef.current?.getSessionId(),
	};
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function init(options?: Partial<EmbedConfig>): EmbedInstance {
	if (currentInstance) {
		console.warn(
			"[Waniwani] Chat widget is already initialized. Call destroy() first to re-initialize.",
		);
		return currentInstance;
	}

	// Parse `data-*` and capture the script element once synchronously —
	// `document.currentScript` is only valid during script execution, so we
	// must grab both here and thread them through (the element is needed to
	// auto-create an inline container in front of it).
	const scriptEl = findScriptTag();
	const scriptConfig = parseConfigFromScript();
	const config = resolveConfig(options, undefined, scriptConfig);

	const mounted =
		config.mode === "floating"
			? mountFloating(config, options, scriptConfig)
			: mountInline(config, options, scriptConfig, scriptEl);

	// Host-page tracking rides on the same public token and channel the chat
	// itself uses; the session id attaches live once the first exchange
	// assigns one.
	const api = config.api ?? "";
	const trackClient = config.token
		? createChatTrackClient({
				api,
				token: config.token,
				channelId: config.channelId,
				getSource: () =>
					loadCachedConfig(api, config.token, config.channelId)?.source ??
					undefined,
				getSessionId: () => mounted.getSessionId(),
			})
		: createNoopChatTrackClient(
				"no public token configured (set data-token or pass token to init())",
			);

	currentInstance = {
		...mounted,
		track: trackClient.track,
		identify: (userId, traits) => trackClient.identify(userId, traits),
		destroy: () => {
			void trackClient.shutdown();
			mounted.destroy();
		},
	};

	// The top-of-funnel `page.viewed` event is fired from `useRemoteEmbedConfig`
	// once the channel's `/config` resolves, so it carries the channel's source.

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

// Calls made before `init()` warn once and are discarded, instead of crashing
// the host page.
const uninitializedTrack = createNoopChatTrackClient(
	"chat widget is not initialized (call WaniWani.chat.init() first)",
);
const liveTrack = (): TrackFn =>
	currentInstance ? currentInstance.track : uninitializedTrack.track;

window.WaniWani = window.WaniWani || {};
window.WaniWani.chat = {
	init,
	destroy,
	open: () => currentInstance?.open(),
	close: () => currentInstance?.close(),
	toggle: () => currentInstance?.toggle(),
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
	getSessionId: () => currentInstance?.getSessionId(),
	track: Object.assign((event: TrackInput) => liveTrack()(event), {
		priceShown: (input: Parameters<TrackFn["priceShown"]>[0]) =>
			liveTrack().priceShown(input),
		pricesCompared: (input: Parameters<TrackFn["pricesCompared"]>[0]) =>
			liveTrack().pricesCompared(input),
		optionSelected: (input: Parameters<TrackFn["optionSelected"]>[0]) =>
			liveTrack().optionSelected(input),
		leadQualified: (input?: Parameters<TrackFn["leadQualified"]>[0]) =>
			liveTrack().leadQualified(input),
		converted: (input: Parameters<TrackFn["converted"]>[0]) =>
			liveTrack().converted(input),
	}),
	identify: (userId: string, traits?: Record<string, unknown>) =>
		currentInstance
			? currentInstance.identify(userId, traits)
			: uninitializedTrack.identify(userId, traits),
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
		console.error("[Waniwani] Auto-initialization failed:", err);
	}
}

if (document.readyState === "loading") {
	document.addEventListener("DOMContentLoaded", autoInit);
} else {
	// DOM is already ready (script loaded with defer/async or injected late)
	autoInit();
}
