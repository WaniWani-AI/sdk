"use client";

import {
	type ModelContextUpdate,
	mergeModelContext,
} from "@waniwani/core/shared/model-context";
// `ai-sdk-react-mcp-apps` is `@ai-sdk/react` pinned to one exact version and
// inlined at build time (see tsup.config.ts). The chat's own `@ai-sdk/react`
// peer can stay on any major, because only this renderer comes from the pin.
import { MCPAppRenderer } from "ai-sdk-react-mcp-apps";
import {
	type ComponentProps,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	resolveWidgetResourceUri,
	type ToolDefinitionsMap,
} from "../ai-elements/tool";
import { MCP_APP_SANDBOX_PROXY_URL } from "../lib/mcp-app-sandbox-proxy";
import { startWidget, type WidgetTimer } from "../lib/timing";
import { useWidgetTimingSink } from "../lib/timing-context";
import { cn } from "../lib/utils";

type RendererProps = ComponentProps<typeof MCPAppRenderer>;
type RendererHandlers = NonNullable<RendererProps["handlers"]>;
type McpAppResource = NonNullable<RendererProps["resource"]>;

const DEFAULT_RESOURCE_ENDPOINT = "/api/mcp/resource";
const MCP_APP_MIME_TYPE = "text/html;profile=mcp-app";
const MAX_HEIGHT = 500;
const MIN_HEIGHT = 50;
const AUTOHEIGHT_PADDING = 16;
/** How long a frame that says it is initialized may take to report a size before we report what we have. */
const SIZE_REPORT_TIMEOUT_MS = 2000;
/** How long a tool result's text waits for a `ui/message` to join before it is sent on its own. */
const TOOL_RESULT_MESSAGE_DELAY_MS = 500;

// Module-level so its identity never changes: the renderer rebuilds its bridge
// whenever `hostInfo` changes.
const HOST_INFO = { name: "Waniwani Chat", version: "1.0.0" };

/**
 * The outer frame holds the sandbox proxy, the inner frame holds the widget.
 * A nested frame can never have more than its parent, so the popup flags (a
 * widget opening a link in a new tab) have to be on both. The inner frame has
 * no `allow-same-origin`: the widget gets an opaque origin wherever the proxy
 * is served from.
 */
const PROXY_FRAME_SANDBOX =
	"allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox";
const WIDGET_FRAME_SANDBOX =
	"allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox";

/**
 * Stands in for an `allowedTools` list when the chat has no tool catalog to
 * build one from (`ChatEmbed` without remote config, the WebMCP overlay). The
 * renderer only ever calls `includes` on the list, and the caller's own
 * `onCallTool` still decides what each call does.
 */
const ANY_TOOL: string[] = Object.assign([], { includes: () => true });

let warnedProxyBlocked = false;

/**
 * The built-in proxy page is a `data:` URL, which a strict `frame-src` blocks.
 * The widget then stays empty with nothing in the console that names the
 * cause, so the first such violation says what to change.
 */
function warnIfProxyBlocked(event: SecurityPolicyViolationEvent): void {
	if (
		warnedProxyBlocked ||
		!event.blockedURI.startsWith("data") ||
		!/^(frame|child|default)-src/.test(event.effectiveDirective)
	) {
		return;
	}
	warnedProxyBlocked = true;
	console.warn(
		"[Waniwani] This page's Content-Security-Policy blocks the widget sandbox, a data: URL. Allow data: in frame-src, or pass mcp.sandboxUrl.",
	);
}

function normalizeString(value: unknown): string | undefined {
	if (typeof value !== "string") {
		return undefined;
	}
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
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

/**
 * Decide whether the text of a tool call result should be auto-injected as
 * a follow-up user message. We skip auto-injection when the tool produces
 * a widget — in that case the widget will render instead of a text bubble.
 *
 * Checks widget binding the spec-canonical way: look up the tool by name
 * in the cached definition catalog first, then fall back to the result's
 * own `_meta` (legacy path).
 */
function shouldAutoInjectToolResultText(
	toolName: string | undefined,
	result: {
		_meta?: Record<string, unknown>;
	},
	toolDefinitions: ToolDefinitionsMap | undefined,
): boolean {
	if (resolveWidgetResourceUri(toolName, result, toolDefinitions)) {
		return false;
	}
	return result._meta?.["waniwani/autoInjectResultText"] !== false;
}

/**
 * The tools a widget may call with `tools/call`. MCP Apps marks a tool the
 * view must not call with `_meta.ui.visibility` that leaves out `"app"`; a
 * tool without a `visibility` is visible to both the model and the view.
 */
export function appCallableTools(
	toolDefinitions: ToolDefinitionsMap | undefined,
): string[] {
	const names = toolDefinitions ? Object.keys(toolDefinitions) : [];
	if (!toolDefinitions || names.length === 0) {
		return ANY_TOOL;
	}
	return names.filter((name) => {
		const ui = toolDefinitions[name]?._meta?.ui;
		const visibility = isRecord(ui) ? ui.visibility : undefined;
		return !Array.isArray(visibility) || visibility.includes("app");
	});
}

/**
 * Fetch a widget's HTML from the chat's resource endpoint. The endpoint can
 * answer with the MCP App resource as JSON (`{ uri, html, meta }`, where
 * `meta` carries the CSP and permissions) or with the HTML itself.
 */
export async function fetchMcpAppResource(
	resourceEndpoint: string,
	uri: string,
	fetchImpl: typeof fetch = fetch,
): Promise<McpAppResource> {
	// String concatenation, not `new URL`, so a relative endpoint resolves
	// against the document. Callers may put query params on the endpoint (the
	// embed appends a `token`), hence the separator check.
	const separator = resourceEndpoint.includes("?") ? "&" : "?";
	const response = await fetchImpl(
		`${resourceEndpoint}${separator}uri=${encodeURIComponent(uri)}`,
		{ headers: { Accept: "application/json, text/html;q=0.9" } },
	);
	if (!response.ok) {
		throw new Error(
			`Widget resource ${uri} failed to load (HTTP ${response.status})`,
		);
	}
	const contentType = response.headers.get("content-type") ?? "";
	if (contentType.includes("application/json")) {
		const body: unknown = await response.json();
		if (!isRecord(body) || typeof body.html !== "string") {
			throw new Error(`Widget resource ${uri} came back without HTML`);
		}
		return {
			uri: typeof body.uri === "string" ? body.uri : uri,
			mimeType: MCP_APP_MIME_TYPE,
			html: body.html,
			...(isRecord(body.meta)
				? { meta: body.meta as McpAppResource["meta"] }
				: {}),
		};
	}
	return { uri, mimeType: MCP_APP_MIME_TYPE, html: await response.text() };
}

/**
 * Keeps one identity for a value while its JSON stays the same. Callers build
 * `toolInput` and `toolResult` inline on every render, and the renderer
 * re-sends the tool input or result to the widget each time either identity
 * changes.
 */
function useStableJson<T>(value: T): T {
	const ref = useRef<{ key: string; value: T } | null>(null);
	const key = JSON.stringify(value) ?? "";
	if (ref.current === null || ref.current.key !== key) {
		ref.current = { key, value };
	}
	return ref.current.value;
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
	/**
	 * URL of the sandbox proxy page the widget loads behind. Serve it from an
	 * origin that is not your app's own. Without it, the chat uses a built-in
	 * proxy page as a `data:` URL.
	 */
	sandboxUrl?: string;
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
	/**
	 * Cached tool catalog keyed by tool name. Decides which tools the widget
	 * may call, and whether a tool it calls produces a widget of its own
	 * (spec-canonical definition lookup) or plain text that becomes a
	 * follow-up message.
	 */
	toolDefinitions?: ToolDefinitionsMap;
}

/**
 * Renders an MCP App widget with the AI SDK's `MCPAppRenderer`. This wrapper
 * adds what is Waniwani's own: the chat session id in the tool result's
 * `_meta.waniwani`, the text of a widget's own tool call becoming a user
 * message, model context that rides on the next message, the 500px height
 * limit, and the widget timing marks.
 */
export function McpAppFrame({
	resourceUri,
	toolInput,
	toolResult,
	resourceEndpoint = DEFAULT_RESOURCE_ENDPOINT,
	sandboxUrl,
	chatSessionId,
	isDark = false,
	className,
	autoHeight = false,
	onOpenLink,
	onFollowUp,
	onCallTool,
	onDisplayModeChange,
	isFullscreen = false,
	toolDefinitions,
}: McpAppFrameProps) {
	const [height, setHeight] = useState(0);
	const [width, setWidth] = useState<number | undefined>(undefined);
	const [displayMode, setDisplayMode] = useState<McpAppDisplayMode>("inline");

	// Read through refs so the handlers object keeps one identity: the
	// renderer swaps its handlers when that identity changes.
	const callbacksRef = useRef({
		onOpenLink,
		onFollowUp,
		onCallTool,
		onDisplayModeChange,
		toolDefinitions,
	});
	callbacksRef.current = {
		onOpenLink,
		onFollowUp,
		onCallTool,
		onDisplayModeChange,
		toolDefinitions,
	};
	const autoHeightRef = useRef(autoHeight);
	autoHeightRef.current = autoHeight;
	// In fullscreen the frame fills its container. The widget still reports
	// its content size, and applying that would shrink the frame, which the
	// widget measures and reports again: a resize loop. So sizes are not
	// applied while fullscreen, and the last inline height comes back on exit.
	const isFullscreenRef = useRef(isFullscreen);
	isFullscreenRef.current = isFullscreen;

	useEffect(() => {
		if (sandboxUrl || typeof document === "undefined") {
			return;
		}
		document.addEventListener("securitypolicyviolation", warnIfProxyBlocked);
		return () =>
			document.removeEventListener(
				"securitypolicyviolation",
				warnIfProxyBlocked,
			);
	}, [sandboxUrl]);

	const timingSink = useWidgetTimingSink();
	const timingRef = useRef<WidgetTimer | null>(null);
	const sizeTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
		undefined,
	);
	useEffect(() => {
		const timer = startWidget(resourceUri, timingSink);
		timingRef.current = timer;
		return () => {
			clearTimeout(sizeTimerRef.current);
			if (!timer.has("initialized")) {
				timer.report("timeout", 0);
			}
			timingRef.current = null;
		};
	}, [resourceUri, timingSink]);

	// A widget's tool call result waits here for the widget's own `ui/message`,
	// and model context waits for the next message of either kind.
	const pendingModelContextRef = useRef<ModelContextUpdate | null>(null);
	const pendingToolResultRef = useRef<{
		text: string;
		timer: ReturnType<typeof setTimeout>;
	} | null>(null);
	useEffect(
		() => () => {
			if (pendingToolResultRef.current) {
				clearTimeout(pendingToolResultRef.current.timer);
				pendingToolResultRef.current = null;
			}
		},
		[],
	);

	const takeModelContext = useCallback(() => {
		const modelContext = pendingModelContextRef.current;
		pendingModelContextRef.current = null;
		return modelContext ? { modelContext } : {};
	}, []);

	const allowedTools = useMemo(
		() => appCallableTools(toolDefinitions),
		[toolDefinitions],
	);

	const handlers = useMemo<RendererHandlers>(
		() => ({
			allowedTools,
			callTool: async ({ name, arguments: args }) => {
				const handler = callbacksRef.current.onCallTool;
				if (!handler) {
					throw new Error("tools/call not supported");
				}
				const result = await handler({ name, arguments: args ?? {} });
				// Plain tools may still return structuredContent, so its presence
				// alone does not decide whether the text becomes a message.
				const text = result.content
					?.map((c) => c.text ?? "")
					.join("")
					.trim();
				if (
					text &&
					shouldAutoInjectToolResultText(
						name,
						result,
						callbacksRef.current.toolDefinitions,
					)
				) {
					if (pendingToolResultRef.current) {
						clearTimeout(pendingToolResultRef.current.timer);
					}
					pendingToolResultRef.current = {
						text,
						timer: setTimeout(() => {
							pendingToolResultRef.current = null;
							callbacksRef.current.onFollowUp?.({
								role: "user",
								content: [{ type: "text", text }],
								...takeModelContext(),
							});
						}, TOOL_RESULT_MESSAGE_DELAY_MS),
					};
				}
				return result;
			},
			sendMessage: (params) => {
				const onFollowUpNow = callbacksRef.current.onFollowUp;
				if (!onFollowUpNow || !isRecord(params)) {
					return {};
				}
				let message = params as {
					role: string;
					content: Array<{ type: string; text?: string }>;
				};
				// A tool result still waiting joins the widget's own message.
				const pending = pendingToolResultRef.current;
				if (pending) {
					clearTimeout(pending.timer);
					pendingToolResultRef.current = null;
					const existingText = (message.content ?? [])
						.map((c) => c.text ?? "")
						.join("")
						.trim();
					message = {
						...message,
						content: [
							{ type: "text", text: `${existingText}\n\n${pending.text}` },
						],
					};
				}
				onFollowUpNow({ ...message, ...takeModelContext() });
				return {};
			},
			updateModelContext: (params) => {
				pendingModelContextRef.current = mergeModelContext(
					pendingModelContextRef.current,
					params as ModelContextUpdate,
				);
				return {};
			},
			openLink: ({ url }) => {
				const open = callbacksRef.current.onOpenLink;
				if (open) {
					open(url);
				} else {
					window.open(url, "_blank", "noopener,noreferrer");
				}
				return {};
			},
			requestDisplayMode: ({ mode }) => {
				const granted: McpAppDisplayMode =
					mode === "fullscreen" || mode === "pip" ? mode : "inline";
				setDisplayMode(granted);
				callbacksRef.current.onDisplayModeChange?.(granted);
				return { mode: granted };
			},
			onInitialized: () => {
				timingRef.current?.mark("initialized");
				sizeTimerRef.current = setTimeout(
					() => timingRef.current?.report("ok", 0),
					SIZE_REPORT_TIMEOUT_MS,
				);
			},
			onSizeChange: ({ width: reportedWidth, height: reportedHeight }) => {
				clearTimeout(sizeTimerRef.current);
				timingRef.current?.mark("firstSize");
				timingRef.current?.report("ok", 0);
				if (typeof reportedHeight === "number" && !isFullscreenRef.current) {
					setHeight(
						autoHeightRef.current
							? Math.max(reportedHeight + AUTOHEIGHT_PADDING, 0)
							: Math.min(Math.max(reportedHeight, MIN_HEIGHT), MAX_HEIGHT),
					);
				}
				if (typeof reportedWidth === "number" && autoHeightRef.current) {
					setWidth(reportedWidth);
				}
			},
		}),
		[allowedTools, takeModelContext],
	);

	const loadResource = useCallback(
		async (app: { resourceUri: string }) => {
			try {
				const resource = await fetchMcpAppResource(
					resourceEndpoint,
					app.resourceUri,
				);
				timingRef.current?.mark("resource");
				return resource;
			} catch (error) {
				timingRef.current?.report("error", 0);
				throw error;
			}
		},
		[resourceEndpoint],
	);

	const input = useStableJson(toolInput);
	const result = useStableJson(toolResult);
	const sessionId = normalizeString(chatSessionId);
	// The widget reads the chat session id from `_meta.waniwani.sessionId` in
	// the tool result, next to whatever the server put there.
	const output = useMemo(() => {
		const meta = isRecord(result._meta) ? result._meta : undefined;
		const waniwani = isRecord(meta?.waniwani) ? meta.waniwani : undefined;
		const forwardedWaniwani =
			waniwani || sessionId
				? { ...(waniwani ?? {}), ...(sessionId ? { sessionId } : {}) }
				: undefined;
		const forwardedMeta =
			meta || forwardedWaniwani
				? {
						...(meta ?? {}),
						...(forwardedWaniwani ? { waniwani: forwardedWaniwani } : {}),
					}
				: undefined;
		return {
			content: result.content ?? [
				{ type: "text", text: JSON.stringify(result) },
			],
			structuredContent: result.structuredContent,
			_meta: forwardedMeta,
			// Compatibility: some clients inspect `meta` instead of `_meta`.
			meta: forwardedMeta,
		};
	}, [result, sessionId]);

	// The renderer reads the widget's resource from `toolMetadata.app` on the
	// tool part. The chat finds the resource from `_meta` instead (definition
	// first, then result), so the part is built here and works with any server.
	const part = useMemo(
		() =>
			({
				type: "dynamic-tool",
				toolName: "mcp-app",
				toolCallId: resourceUri,
				state: "output-available",
				input,
				output,
				toolMetadata: {
					app: { resourceUri, mimeType: MCP_APP_MIME_TYPE },
				},
			}) as unknown as RendererProps["part"],
		[resourceUri, input, output],
	);

	const hostContext = useMemo(
		() => ({
			theme: isDark ? ("dark" as const) : ("light" as const),
			displayMode,
		}),
		[isDark, displayMode],
	);

	const sandbox = useMemo<RendererProps["sandbox"]>(
		() => ({
			url: sandboxUrl ?? MCP_APP_SANDBOX_PROXY_URL,
			// A `data:` page has an opaque origin, which no message can target
			// by name. The renderer still checks that each message comes from
			// this frame's own window.
			...(sandboxUrl ? {} : { targetOrigin: "*" }),
			outerSandbox: PROXY_FRAME_SANDBOX,
			innerSandbox: WIDGET_FRAME_SANDBOX,
			className: cn(
				!isFullscreen && "ww:rounded-md ww:border ww:border-border",
				className,
			),
			style: {
				height: isFullscreen ? "100%" : height,
				minWidth: isFullscreen || !width ? undefined : `min(${width}px, 100%)`,
				width: "100%",
				border: "none",
				colorScheme: isDark ? "dark" : "auto",
			},
		}),
		[sandboxUrl, isFullscreen, className, height, width, isDark],
	);

	return (
		<MCPAppRenderer
			key={resourceUri}
			part={part}
			sandbox={sandbox}
			loadResource={loadResource}
			handlers={handlers}
			hostInfo={HOST_INFO}
			hostContext={hostContext}
		/>
	);
}
