"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "../lib/utils";

const DEFAULT_RESOURCE_ENDPOINT = "/api/mcp/resource";
const MAX_HEIGHT = 500;
const DEFAULT_HEIGHT = 300;
const PROTOCOL_VERSION = "2026-01-26";
const RESIZE_ANIMATION_MS = 300;

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
	/** Called when the view sends a chat message */
	onMessage?: (message: { role: string; content: string }) => void;
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
	onMessage,
}: McpAppFrameProps) {
	const iframeRef = useRef<HTMLIFrameElement>(null);
	const toolInputRef = useRef(toolInput);
	const toolResultRef = useRef(toolResult);
	const lastSizeRef = useRef({ width: 0, height: 0 });
	const initializedRef = useRef(false);
	const [height, setHeight] = useState(DEFAULT_HEIGHT);
	const [width, setWidth] = useState<number | undefined>(undefined);
	const onOpenLinkRef = useRef(onOpenLink);
	const onMessageRef = useRef(onMessage);

	toolInputRef.current = toolInput;
	toolResultRef.current = toolResult;
	onOpenLinkRef.current = onOpenLink;
	onMessageRef.current = onMessage;

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

		const postToIframe = (msg: Record<string, unknown>) => {
			iframe.contentWindow?.postMessage(msg, "*");
		};

		const handleMessage = (event: MessageEvent) => {
			if (disposed) return;
			if (event.source !== iframe.contentWindow) return;

			const data = event.data;
			if (!data || typeof data !== "object" || data.jsonrpc !== "2.0") return;

			const method: string | undefined = data.method;
			const id: number | string | undefined = data.id;

			// ui/initialize — widget requests handshake
			if (method === "ui/initialize" && id != null) {
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

				if (!heightChanged && !widthChanged) return;

				if (heightChanged && newHeight !== undefined) {
					last.height = newHeight;
					const clamped = clampHeight(newHeight);

					// Animate the height transition
					if (iframe.animate) {
						const from = iframe.getBoundingClientRect().height;
						if (Math.abs(from - clamped) > 2) {
							iframe.animate(
								[{ height: `${from}px` }, { height: `${clamped}px` }],
								{
									duration: RESIZE_ANIMATION_MS,
									easing: "ease-out",
									fill: "forwards",
								},
							);
						}
					}
					setHeight(clamped);
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
				if (onMessageRef.current && data.params) {
					onMessageRef.current(data.params);
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
			disposed = true;
			window.removeEventListener("message", handleMessage);
		};
	}, [autoHeight, clampHeight]);

	return (
		<iframe
			ref={iframeRef}
			src={iframeSrc}
			sandbox="allow-scripts allow-forms allow-same-origin"
			className={cn("rounded-md border border-border", className)}
			style={{
				height: height || undefined,
				minWidth: width ? `min(${width}px, 100%)` : undefined,
				width: "100%",
				border: "none",
				colorScheme: "auto",
			}}
			title="MCP App"
		/>
	);
}
