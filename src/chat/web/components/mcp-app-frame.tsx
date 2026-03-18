"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	type ModelContextUpdate,
	mergeModelContext,
} from "../../../shared/model-context";
import { cn } from "../lib/utils";

const DEFAULT_RESOURCE_ENDPOINT = "/api/mcp/resource";
const MAX_HEIGHT = 500;
const DEFAULT_HEIGHT = 0;
const AUTOHEIGHT_PADDING = 16;
const PROTOCOL_VERSION = "2026-01-26";
const RESIZE_ANIMATION_MS = 300;
const HANDSHAKE_TIMEOUT_MS = 3000;
const MAX_RETRIES = 3;

function normalizeString(value: unknown): string | undefined {
	if (typeof value !== "string") {
		return undefined;
	}
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

export function resultProducesWidget(result: {
	_meta?: Record<string, unknown>;
}): boolean {
	const meta = result._meta;
	if (!meta || typeof meta !== "object") {
		return false;
	}

	const openaiTemplate = normalizeString(meta["openai/outputTemplate"]);
	if (openaiTemplate) {
		return true;
	}

	const uiMeta = meta.ui;
	if (!uiMeta || typeof uiMeta !== "object") {
		return false;
	}

	const resourceUri = normalizeString(
		(uiMeta as Record<string, unknown>).resourceUri,
	);
	return Boolean(resourceUri);
}

function shouldAutoInjectToolResultText(result: {
	_meta?: Record<string, unknown>;
}): boolean {
	if (resultProducesWidget(result)) {
		return false;
	}
	return result._meta?.["waniwani/autoInjectResultText"] !== false;
}

export type McpAppDisplayMode = "inline" | "pip" | "fullscreen";

export interface McpAppFrameProps {
	resourceUri: string;
	toolInput: Record<string, unknown>;
	toolResult: {
		content?: Array<{ type: string; text?: string }>;
		structuredContent?: Record<string, unknown>;
		_meta?: Record<string, unknown>;
	};
	resourceEndpoint?: string;
	chatSessionId?: string;
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
		modelContext?: ModelContextUpdate;
	}) => void;
	/** Called when a widget calls a tool via `tools/call` (MCP Apps standard). */
	onCallTool?: (params: {
		name: string;
		arguments: Record<string, unknown>;
	}) => Promise<{
		content?: Array<{ type: string; text?: string }>;
		structuredContent?: Record<string, unknown>;
		_meta?: Record<string, unknown>;
	}>;
	/** Called when the widget requests a display mode change (e.g. "fullscreen" for expand) */
	onDisplayModeChange?: (mode: McpAppDisplayMode) => void;
	/** When true, the iframe fills its container (fullscreen mode). */
	isFullscreen?: boolean;
}

export function McpAppFrame({
	resourceUri,
	toolInput,
	toolResult,
	resourceEndpoint = DEFAULT_RESOURCE_ENDPOINT,
	chatSessionId,
	isDark = false,
	className,
	autoHeight = false,
	onOpenLink,
	onFollowUp,
	onCallTool,
	onDisplayModeChange,
	isFullscreen = false,
}: McpAppFrameProps) {
	const iframeRef = useRef<HTMLIFrameElement>(null);
	const toolInputRef = useRef(toolInput);
	const toolResultRef = useRef(toolResult);
	const lastSizeRef = useRef({ width: 0, height: 0 });
	const animationRef = useRef<Animation | null>(null);
	const initializedRef = useRef(false);
	const retryCountRef = useRef(0);
	const displayModeRef = useRef<McpAppDisplayMode>("inline");
	const [height, setHeight] = useState(DEFAULT_HEIGHT);
	const [width, setWidth] = useState<number | undefined>(undefined);
	const onOpenLinkRef = useRef(onOpenLink);
	const onFollowUpRef = useRef(onFollowUp);
	const onCallToolRef = useRef(onCallTool);
	const onDisplayModeChangeRef = useRef(onDisplayModeChange);
	const chatSessionIdRef = useRef(chatSessionId);

	toolInputRef.current = toolInput;
	toolResultRef.current = toolResult;
	onOpenLinkRef.current = onOpenLink;
	onFollowUpRef.current = onFollowUp;
	onCallToolRef.current = onCallTool;
	onDisplayModeChangeRef.current = onDisplayModeChange;
	chatSessionIdRef.current = chatSessionId;

	const clampHeight = useCallback(
		(h: number) => {
			if (autoHeight) {
				return Math.max(h + AUTOHEIGHT_PADDING, 0);
			}
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
		if (!initializedRef.current) {
			return;
		}
		const iframe = iframeRef.current;
		if (!iframe?.contentWindow) {
			return;
		}

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
		if (!iframe) {
			return;
		}

		let disposed = false;
		let handshakeReceived = false;
		let pendingModelContext: ModelContextUpdate | null = null;
		let pendingToolResult: {
			text: string;
			timer: ReturnType<typeof setTimeout>;
		} | null = null;

		// Retry: reload iframe if handshake doesn't arrive in time
		const handshakeTimer = setTimeout(() => {
			if (disposed || handshakeReceived) {
				return;
			}
			if (retryCountRef.current >= MAX_RETRIES) {
				return;
			}
			retryCountRef.current += 1;
			// Force reload with a cache-busting param
			const url = new URL(iframe.src);
			url.searchParams.set("_retry", String(retryCountRef.current));
			iframe.src = url.toString();
		}, HANDSHAKE_TIMEOUT_MS);

		const postToIframe = (msg: Record<string, unknown>) => {
			iframe.contentWindow?.postMessage(msg, "*");
		};

		const handleMessage = (event: MessageEvent) => {
			if (disposed) {
				return;
			}
			if (event.source !== iframe.contentWindow) {
				return;
			}

			const data = event.data;

			if (!data || typeof data !== "object" || data.jsonrpc !== "2.0") {
				return;
			}

			const method: string | undefined = data.method;
			const id: number | string | undefined = data.id;

			// ui/initialize — widget requests handshake
			if (method === "ui/initialize" && id != null) {
				handshakeReceived = true;
				clearTimeout(handshakeTimer);
				postToIframe({
					jsonrpc: "2.0",
					id,
					result: {
						protocolVersion: data.params?.protocolVersion ?? PROTOCOL_VERSION,
						hostInfo: { name: "WaniWani Chat", version: "1.0.0" },
						hostCapabilities: {
							openLinks: {},
							message: {
								text: {},
							},
							tools: {},
							updateModelContext: {
								text: {},
								structuredContent: {},
							},
						},
						hostContext: {
							theme: isDarkRef.current ? "dark" : "light",
							displayMode: displayModeRef.current,
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
				const resultMeta =
					result._meta && typeof result._meta === "object"
						? result._meta
						: null;
				const normalizedChatSessionId = normalizeString(
					chatSessionIdRef.current,
				);
				const waniwaniMeta =
					resultMeta &&
					typeof resultMeta.waniwani === "object" &&
					resultMeta.waniwani !== null
						? (resultMeta.waniwani as Record<string, unknown>)
						: null;
				const forwardedWaniwaniMeta =
					waniwaniMeta || normalizedChatSessionId
						? {
								...(waniwaniMeta ?? {}),
								...(normalizedChatSessionId
									? { sessionId: normalizedChatSessionId }
									: {}),
							}
						: undefined;
				const forwardedMeta =
					resultMeta || forwardedWaniwaniMeta
						? {
								...(resultMeta ?? {}),
								...(forwardedWaniwaniMeta
									? { waniwani: forwardedWaniwaniMeta }
									: {}),
							}
						: undefined;

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
						_meta: forwardedMeta,
						// Compatibility: some clients inspect `meta` instead of `_meta`.
						meta: forwardedMeta,
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

				if (!heightChanged && !widthChanged) {
					return;
				}

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
					let params = data.params;
					const modelContext = pendingModelContext;
					pendingModelContext = null;
					// Merge pending tool result into the follow-up message
					if (pendingToolResult) {
						clearTimeout(pendingToolResult.timer);
						const toolText = pendingToolResult.text;
						pendingToolResult = null;
						const existingText = (params.content ?? [])
							.map((c: { text?: string }) => c.text ?? "")
							.join("")
							.trim();
						params = {
							...params,
							content: [
								{ type: "text", text: `${existingText}\n\n${toolText}` },
							],
						};
					}
					onFollowUpRef.current({
						...params,
						...(modelContext ? { modelContext } : {}),
					});
				}
				postToIframe({ jsonrpc: "2.0", id, result: {} });
				return;
			}

			// ui/update-model-context — widget updates hidden model context
			if (method === "ui/update-model-context" && id != null) {
				pendingModelContext = mergeModelContext(
					pendingModelContext,
					data.params as ModelContextUpdate,
				);
				postToIframe({ jsonrpc: "2.0", id, result: {} });
				return;
			}

			// tools/call — widget calls a server tool (MCP Apps standard)
			if (method === "tools/call" && id != null) {
				const handler = onCallToolRef.current;
				if (!handler) {
					postToIframe({
						jsonrpc: "2.0",
						id,
						error: { code: -32601, message: "tools/call not supported" },
					});
					return;
				}
				handler({
					name: data.params?.name,
					arguments: data.params?.arguments ?? {},
				})
					.then((result) => {
						postToIframe({ jsonrpc: "2.0", id, result });

						// Schedule auto-injection for non-widget tool results. Plain
						// tools may still return structuredContent, so the presence of
						// structuredContent alone is not enough to decide this.
						const text = result.content
							?.map((c) => c.text ?? "")
							.join("")
							.trim();
						if (text && shouldAutoInjectToolResultText(result)) {
							if (pendingToolResult) {
								clearTimeout(pendingToolResult.timer);
							}
							pendingToolResult = {
								text,
								timer: setTimeout(() => {
									if (disposed) {
										return;
									}
									const modelContext = pendingModelContext;
									pendingModelContext = null;
									pendingToolResult = null;
									onFollowUpRef.current?.({
										role: "user",
										content: [{ type: "text", text }],
										...(modelContext ? { modelContext } : {}),
									});
								}, 500),
							};
						}
					})
					.catch((err: unknown) => {
						const message =
							err instanceof Error ? err.message : "Tool call failed";
						postToIframe({
							jsonrpc: "2.0",
							id,
							error: { code: -32000, message },
						});
					});
				return;
			}

			// ui/request-display-mode — widget requests fullscreen/inline/pip
			if (method === "ui/request-display-mode" && id != null) {
				const requested = data.params?.mode;
				const granted =
					requested === "fullscreen" ||
					requested === "inline" ||
					requested === "pip"
						? requested
						: "inline";
				displayModeRef.current = granted;
				// Reply with the granted mode
				postToIframe({
					jsonrpc: "2.0",
					id,
					result: { mode: granted },
				});
				// Notify the widget of the context change
				postToIframe({
					jsonrpc: "2.0",
					method: "ui/notifications/host-context-changed",
					params: { displayMode: granted },
				});
				onDisplayModeChangeRef.current?.(granted);
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
			clearTimeout(handshakeTimer);
			if (pendingToolResult) {
				clearTimeout(pendingToolResult.timer);
			}
			window.removeEventListener("message", handleMessage);
		};
	}, [autoHeight, clampHeight]);

	return (
		<iframe
			ref={iframeRef}
			src={iframeSrc}
			sandbox="allow-scripts allow-forms allow-same-origin"
			className={cn(
				!isFullscreen && "ww:rounded-md ww:border ww:border-border",
				className,
			)}
			style={{
				height: isFullscreen ? "100%" : height,
				minWidth: isFullscreen || !width ? undefined : `min(${width}px, 100%)`,
				width: "100%",
				border: "none",
				colorScheme: isDark ? "dark" : "auto",
			}}
			title="MCP App"
		/>
	);
}
