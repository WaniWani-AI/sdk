"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "../lib/utils";

const DEFAULT_RESOURCE_ENDPOINT = "/api/mcp/resource";
const MAX_HEIGHT = 500;
const DEFAULT_HEIGHT = 0;
const PROTOCOL_VERSION = "2026-01-26";
const RESIZE_ANIMATION_MS = 300;
const HANDSHAKE_TIMEOUT_MS = 3000;
const MAX_RETRIES = 3;

export interface McpAppFrameProps {
	resourceUri: string;
	toolInput: Record<string, unknown>;
	toolResult: {
		content?: Array<{ type: string; text?: string }>;
		structuredContent?: Record<string, unknown>;
	};
	resourceEndpoint?: string;
	isDark?: boolean;
	className?: string;
	/** When true, the iframe height auto-adapts to its content. Set via `_meta.ui.autoHeight` in the tool result. */
	autoHeight?: boolean;
	/** Called when the view requests to open a URL */
	onOpenLink?: (url: string) => void;
	/** Called when a widget sends a follow-up message via `ui/message` */
	onFollowUp?: (message: {
		role: string;
		content: Array<{ type: string; text?: string }>;
	}) => void;
}

export function McpAppFrame({
	resourceUri,
	toolInput,
	toolResult,
	resourceEndpoint = DEFAULT_RESOURCE_ENDPOINT,
	isDark = false,
	className,
	// TODO: REMOVE — defaulting to true for playground testing
	autoHeight = true,
	onOpenLink,
	onFollowUp,
}: McpAppFrameProps) {
	const iframeRef = useRef<HTMLIFrameElement>(null);
	const toolInputRef = useRef(toolInput);
	const toolResultRef = useRef(toolResult);
	const lastSizeRef = useRef({ width: 0, height: 0 });
	const animationRef = useRef<Animation | null>(null);
	const initializedRef = useRef(false);
	const retryCountRef = useRef(0);
	const [height, setHeight] = useState(DEFAULT_HEIGHT);
	const [width, setWidth] = useState<number | undefined>(undefined);
	const onOpenLinkRef = useRef(onOpenLink);
	const onFollowUpRef = useRef(onFollowUp);

	toolInputRef.current = toolInput;
	toolResultRef.current = toolResult;
	onOpenLinkRef.current = onOpenLink;
	onFollowUpRef.current = onFollowUp;

	const clampHeight = useCallback(
		(h: number) => {
			if (autoHeight) return Math.max(h, 0);
			return Math.min(Math.max(h, 50), MAX_HEIGHT);
		},
		[autoHeight],
	);

	// Build the iframe src URL directly — avoids null-origin issues with srcdoc
	const iframeSrc = useMemo(
		() => `${resourceEndpoint}?uri=${encodeURIComponent(resourceUri)}`,
		[resourceEndpoint, resourceUri],
	);

	const isDarkRef = useRef(isDark);
	isDarkRef.current = isDark;

	// Send theme changes to the iframe (only after handshake is complete)
	useEffect(() => {
		if (!initializedRef.current) return;
		const iframe = iframeRef.current;
		if (!iframe?.contentWindow) return;

		iframe.contentWindow.postMessage(
			{
				jsonrpc: "2.0",
				method: "ui/notifications/host-context-changed",
				params: {
					theme: isDark ? "dark" : "light",
				},
			},
			"*",
		);
	}, [isDark]);

	// Synchronous postMessage protocol handler — no async imports, no timing issues.
	// Handles the MCP UI protocol (ui/initialize, notifications, etc.) directly.
	useEffect(() => {
		const iframe = iframeRef.current;
		if (!iframe) return;

		let disposed = false;
		let handshakeReceived = false;
		const debug = (...args: unknown[]) =>
			console.debug("[McpAppFrame]", ...args);

		debug("effect mounted, waiting for handshake");

		// Retry: reload iframe if handshake doesn't arrive in time
		const handshakeTimer = setTimeout(() => {
			if (disposed || handshakeReceived) return;
			if (retryCountRef.current >= MAX_RETRIES) {
				debug("handshake failed after", MAX_RETRIES, "retries, giving up");
				return;
			}
			retryCountRef.current += 1;
			debug(
				"handshake timeout, reloading iframe (retry",
				retryCountRef.current,
				"of",
				MAX_RETRIES,
				")",
			);
			// Force reload with a cache-busting param
			const url = new URL(iframe.src);
			url.searchParams.set("_retry", String(retryCountRef.current));
			iframe.src = url.toString();
		}, HANDSHAKE_TIMEOUT_MS);

		const postToIframe = (msg: Record<string, unknown>) => {
			debug("→ send", msg.method ?? `response:${msg.id}`, msg);
			iframe.contentWindow?.postMessage(msg, "*");
		};

		const handleMessage = (event: MessageEvent) => {
			if (disposed) return;
			if (event.source !== iframe.contentWindow) return;

			const data = event.data;
			if (!data || typeof data !== "object" || data.jsonrpc !== "2.0") return;

			const method: string | undefined = data.method;
			const id: number | string | undefined = data.id;

			debug("← recv", method ?? `response:${id}`, data);

			// ui/initialize — widget requests handshake
			if (method === "ui/initialize" && id != null) {
				handshakeReceived = true;
				clearTimeout(handshakeTimer);
				debug("handshake started");
				postToIframe({
					jsonrpc: "2.0",
					id,
					result: {
						protocolVersion: data.params?.protocolVersion ?? PROTOCOL_VERSION,
						hostInfo: { name: "WaniWani Chat", version: "1.0.0" },
						hostCapabilities: {
							openLinks: {},
							message: {},
						},
						hostContext: {
							theme: isDarkRef.current ? "dark" : "light",
							displayMode: "inline",
						},
					},
				});
				return;
			}

			// ui/notifications/initialized — widget confirms init, we send tool data
			if (method === "ui/notifications/initialized") {
				debug("handshake complete, sending tool data");
				initializedRef.current = true;
				const input = toolInputRef.current;
				const result = toolResultRef.current;

				postToIframe({
					jsonrpc: "2.0",
					method: "ui/notifications/tool-input",
					params: { arguments: input },
				});

				const content = result.content ?? [
					{ type: "text", text: JSON.stringify(result) },
				];
				postToIframe({
					jsonrpc: "2.0",
					method: "ui/notifications/tool-result",
					params: {
						content,
						structuredContent: result.structuredContent,
					},
				});
				return;
			}

			// ui/notifications/size-changed — widget reports content size
			if (method === "ui/notifications/size-changed") {
				const params = data.params;
				const newHeight =
					typeof params?.height === "number" ? params.height : undefined;
				const newWidth =
					typeof params?.width === "number" ? params.width : undefined;

				// Deduplicate — only update if values actually changed (prevents feedback loops)
				const last = lastSizeRef.current;
				const heightChanged =
					newHeight !== undefined && newHeight !== last.height;
				const widthChanged = newWidth !== undefined && newWidth !== last.width;

				debug("size-changed", {
					newHeight,
					newWidth,
					lastHeight: last.height,
					lastWidth: last.width,
					heightChanged,
					widthChanged,
				});

				if (!heightChanged && !widthChanged) return;

				if (heightChanged && newHeight !== undefined) {
					last.height = newHeight;
					const clamped = clampHeight(newHeight);

					// Get current visual height before canceling the old animation
					const from = iframe.getBoundingClientRect().height;

					// Cancel previous animation so its fill: "forwards" stops overriding inline style
					if (animationRef.current) {
						animationRef.current.cancel();
						animationRef.current = null;
					}

					// Set the target height in React state (takes effect once no animation overrides it)
					setHeight(clamped);

					// Animate the height transition
					if (iframe.animate && Math.abs(from - clamped) > 2) {
						const anim = iframe.animate(
							[{ height: `${from}px` }, { height: `${clamped}px` }],
							{
								duration: RESIZE_ANIMATION_MS,
								easing: "ease-out",
								fill: "forwards",
							},
						);
						animationRef.current = anim;
						// Once done, remove the animation so the inline style is the source of truth
						anim.onfinish = () => {
							if (animationRef.current === anim) {
								anim.cancel();
								animationRef.current = null;
							}
						};
					}
				}

				if (widthChanged && autoHeight && newWidth !== undefined) {
					last.width = newWidth;
					setWidth(newWidth);
				}
				return;
			}

			// ui/open-link — widget requests to open a URL
			if (method === "ui/open-link" && id != null) {
				const url = data.params?.url;
				if (typeof url === "string") {
					if (onOpenLinkRef.current) {
						onOpenLinkRef.current(url);
					} else {
						window.open(url, "_blank", "noopener,noreferrer");
					}
				}
				postToIframe({ jsonrpc: "2.0", id, result: {} });
				return;
			}

			// ui/message — widget sends a chat message
			if (method === "ui/message" && id != null) {
				if (onFollowUpRef.current && data.params) {
					onFollowUpRef.current(data.params);
				}
				postToIframe({ jsonrpc: "2.0", id, result: {} });
				return;
			}

			// ui/request-display-mode — widget requests fullscreen/inline/pip
			if (method === "ui/request-display-mode" && id != null) {
				// Acknowledge but stay inline for now
				postToIframe({ jsonrpc: "2.0", id, result: {} });
				return;
			}

			// ui/resource-teardown — graceful shutdown
			if (method === "ui/resource-teardown" && id != null) {
				postToIframe({ jsonrpc: "2.0", id, result: {} });
				return;
			}

			// ping — keep-alive
			if (method === "ping" && id != null) {
				postToIframe({ jsonrpc: "2.0", id, result: {} });
			}
		};

		window.addEventListener("message", handleMessage);

		return () => {
			debug("effect cleanup (disposed)");
			disposed = true;
			clearTimeout(handshakeTimer);
			window.removeEventListener("message", handleMessage);
		};
	}, [autoHeight, clampHeight]);

	return (
		<iframe
			ref={iframeRef}
			src={iframeSrc}
			sandbox="allow-scripts allow-forms allow-same-origin"
			className={cn("ww:rounded-md ww:border ww:border-border", className)}
			style={{
				height,
				minWidth: width ? `min(${width}px, 100%)` : undefined,
				width: "100%",
				border: "none",
				colorScheme: "auto",
			}}
			title="MCP App"
		/>
	);
}
