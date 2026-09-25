"use client";

import React from "react";
import ReactDOM from "react-dom/client";
import { getOrCreateVisitorId } from "../../../shared/visitor-id";
import {
	createWebMcpBridge,
	supportsWebMcp,
	type WebMcpBridge,
	type WebMcpWidgetPayload,
} from "../../../webmcp";
import { debugLog } from "../lib/debug";
import type { EmbedConfig } from "./config";
import { injectEmbedCss } from "./embed-css";
import { loadCachedConfig } from "./remote-config";
import {
	resolveWebMcpEndpoints,
	type WebMcpEndpoints,
} from "./webmcp-endpoints";
import { WebMcpOverlay } from "./webmcp-overlay";

/**
 * Publishing the site's MCP tools to a browsing agent, from inside the chat
 * embed.
 *
 * Attached to the embed rather than shipped as a second script because the two
 * want the same three things and the customer should install one tag: the
 * visitor id, the widget host, and a resolved server URL. A page that already
 * has the chat gains this for a few kilobytes.
 *
 * Everything below is skipped on a browser with no `modelContext`, which is
 * every visit but the ones this exists for. The check is synchronous and first,
 * so an ordinary visitor pays one property read.
 */

/**
 * Keys the flow engine's state. Tab-scoped on purpose: a value that outlives
 * the tab resumes a flow abandoned days ago in the middle of the question it
 * was abandoned on, and one that changes between calls restarts every flow.
 * Visitor identity is separate and persistent, and both are sent.
 */
const SESSION_KEY = "waniwani:webmcp:session";

function tabSessionId(): string {
	try {
		const stored = sessionStorage.getItem(SESSION_KEY);
		if (stored) {
			return stored;
		}
		const minted = crypto.randomUUID();
		sessionStorage.setItem(SESSION_KEY, minted);
		return minted;
	} catch {
		// Private mode, or a browser refusing storage. A per-load id still keys a
		// flow correctly for the length of that load, which is the common case.
		return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
	}
}

/**
 * The endpoints, plus the channel's switch and id, read from the session cache.
 *
 * Cache rather than a fetch: a browsing agent's visit is the uncached one, and
 * a round trip here sits in front of every tool registration. A first visit
 * publishes without a channel and picks one up from the second page onward.
 */
function resolveWebMcp(config: EmbedConfig): WebMcpEndpoints | null {
	const cached = config.token
		? loadCachedConfig(config.api ?? "", config.token, config.channelId)
		: null;
	const resolved = resolveWebMcpEndpoints(
		config,
		cached?.webmcp?.enabled,
		cached?.channelId,
	);
	if (!resolved) {
		debugLog("[webmcp] not publishing site tools: switched off, or no token");
	}
	return resolved;
}

function prefersDark(): boolean {
	try {
		return window.matchMedia("(prefers-color-scheme: dark)").matches;
	} catch {
		return false;
	}
}

type WidgetListener = (widget: WebMcpWidgetPayload) => void;

/**
 * Hands widget steps from the bridge to the overlay. The bridge starts before
 * React mounts, so a step arriving first is held for the first subscriber.
 */
function createWidgetRelay() {
	let listener: WidgetListener | null = null;
	let held: WebMcpWidgetPayload | null = null;
	return {
		emit(widget: WebMcpWidgetPayload) {
			if (listener) {
				listener(widget);
			} else {
				held = widget;
			}
		},
		subscribe(next: WidgetListener) {
			listener = next;
			if (held) {
				next(held);
				held = null;
			}
			return () => {
				if (listener === next) {
					listener = null;
				}
			};
		},
	};
}

/** Owns the widget on screen. */
function WebMcpHost({
	toolsEndpoint,
	resourceEndpoint,
	subscribe,
}: Pick<WebMcpEndpoints, "toolsEndpoint" | "resourceEndpoint"> & {
	subscribe: (listener: WidgetListener) => () => void;
}) {
	const [widget, setWidget] = React.useState<WebMcpWidgetPayload | null>(null);
	const [isDark, setIsDark] = React.useState(prefersDark);

	React.useEffect(() => subscribe(setWidget), [subscribe]);

	React.useEffect(() => {
		let media: MediaQueryList;
		try {
			media = window.matchMedia("(prefers-color-scheme: dark)");
		} catch {
			return;
		}
		const onChange = () => setIsDark(media.matches);
		media.addEventListener("change", onChange);
		return () => media.removeEventListener("change", onChange);
	}, []);

	return (
		<WebMcpOverlay
			widget={widget}
			toolsEndpoint={toolsEndpoint}
			resourceEndpoint={resourceEndpoint}
			isDark={isDark}
			onClose={() => setWidget(null)}
		/>
	);
}

export type WebMcpHandle = {
	/** Tools published to the agent. Empty until the bridge has listed them. */
	getTools: () => string[];
	destroy: () => void;
};

/**
 * Start WebMCP for this page. Returns `null` when the browser has no
 * `modelContext`, when the page has switched the surface off, or when there is
 * no token. None of those are errors.
 */
export function startWebMcp(config: EmbedConfig): WebMcpHandle | null {
	// First and synchronous. Every visit that is not a browsing agent stops
	// here, having done one property read and no network.
	if (!supportsWebMcp()) {
		return null;
	}

	const resolved = resolveWebMcp(config);
	if (!resolved) {
		return null;
	}

	// Its own host element and shadow root, independent of the chat's. A widget
	// step arrives whether the panel is open or not, whether the chat mounted
	// inline or floating, and whether it mounted at all.
	const host = document.createElement("div");
	host.setAttribute("data-waniwani-webmcp", "");
	// One rung above the chat panel's host, which is appended after this one
	// and would otherwise paint over a widget at the same z-index.
	host.style.cssText = "position:relative;z-index:2147483001;";
	document.body.appendChild(host);
	const shadow = host.attachShadow({ mode: "open" });
	// Its own copy of the stylesheet. The overlay is a sibling of the chat, not a
	// child, so it inherits nothing from the chat's root — and it has to render
	// correctly on a page where the chat never mounted at all.
	injectEmbedCss(shadow);
	const container = document.createElement("div");
	shadow.appendChild(container);

	// After the host exists, so a DOM failure never leaves tools registered
	// with no owner, and before the render, so the listing is on the wire
	// while the overlay mounts.
	const relay = createWidgetRelay();
	let bridge: WebMcpBridge | null = null;
	let destroyed = false;
	void createWebMcpBridge({
		endpoint: resolved.toolsEndpoint,
		listEndpoint: resolved.listEndpoint,
		headers: resolved.headers,
		channelId: resolved.channelId,
		sessionId: tabSessionId(),
		visitorId: getOrCreateVisitorId(),
		onWidget: relay.emit,
	})
		.then((created) => {
			if (destroyed) {
				created?.dispose();
				return;
			}
			bridge = created;
		})
		.catch((error) => {
			console.error("[webmcp] could not publish site tools", error);
		});

	const root = ReactDOM.createRoot(container);
	root.render(
		<WebMcpHost
			toolsEndpoint={resolved.toolsEndpoint}
			resourceEndpoint={resolved.resourceEndpoint}
			subscribe={relay.subscribe}
		/>,
	);

	return {
		getTools: () => (bridge?.tools ?? []).map((tool) => tool.name),
		destroy: () => {
			destroyed = true;
			bridge?.dispose();
			root.unmount();
			host.remove();
		},
	};
}
