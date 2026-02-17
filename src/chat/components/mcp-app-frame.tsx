"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "../lib/utils";

const DEFAULT_RESOURCE_ENDPOINT = "/api/mcp/resource";
const MAX_HEIGHT = 500;
const DEFAULT_HEIGHT = 300;
const PROTOCOL_VERSION = "2026-01-26";

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
}: McpAppFrameProps) {
	const iframeRef = useRef<HTMLIFrameElement>(null);
	const toolInputRef = useRef(toolInput);
	const toolResultRef = useRef(toolResult);
	const heightSettledRef = useRef(false);
	const [height, setHeight] = useState(DEFAULT_HEIGHT);

	toolInputRef.current = toolInput;
	toolResultRef.current = toolResult;

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
						hostCapabilities: {},
						hostContext: {
							theme: isDarkRef.current ? "dark" : "light",
							autoHeight,
						},
					},
				});
				return;
			}

			// ui/notifications/initialized — widget confirms init, we send tool data
			if (method === "ui/notifications/initialized") {
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

			// ui/notifications/size-changed — widget requests resize
			if (method === "ui/notifications/size-changed") {
				if (heightSettledRef.current) return;
				const h = data.params?.height;
				if (typeof h === "number" && !disposed) {
					setHeight(clampHeight(h));
				}
				return;
			}

			// ui/open-link — widget requests to open a URL
			if (method === "ui/open-link" && id != null) {
				const url = data.params?.url;
				if (typeof url === "string") {
					window.open(url, "_blank", "noopener,noreferrer");
				}
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

	// Auto-height: observe the iframe body size via ResizeObserver (same-origin only)
	useEffect(() => {
		if (!autoHeight) return;

		const iframe = iframeRef.current;
		if (!iframe) return;

		let observer: ResizeObserver | undefined;
		let disposed = false;

		const attach = () => {
			if (disposed) return;
			try {
				const body = iframe.contentDocument?.body;
				if (!body) return;

				observer = new ResizeObserver(() => {
					if (disposed) return;
					const style = iframe.contentDocument?.defaultView?.getComputedStyle(body);
					const marginTop = Number.parseInt(style?.marginTop ?? "0", 10) || 0;
					const marginBottom = Number.parseInt(style?.marginBottom ?? "0", 10) || 0;
					const h = Math.max(body.scrollHeight, body.offsetHeight) + marginTop + marginBottom;
					if (h > 0) setHeight(h);
				});

				observer.observe(body);
			} catch {
				// Cross-origin — fall back to postMessage size-changed protocol
			}
		};

		iframe.addEventListener("load", attach);
		attach();

		return () => {
			disposed = true;
			observer?.disconnect();
			iframe.removeEventListener("load", attach);
		};
	}, [autoHeight]);

	return (
		<iframe
			ref={iframeRef}
			src={iframeSrc}
			sandbox="allow-scripts allow-forms allow-same-origin"
			className={cn("w-full rounded-md border border-border", className)}
			style={{
				height: height || undefined,
				border: "none",
				colorScheme: "auto",
			}}
			title="MCP App"
		/>
	);
}
