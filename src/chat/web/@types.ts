// ============================================================================
// Chat Theme
// ============================================================================

export interface ChatTheme {
	/** Primary brand color (bubble, send button, user messages) */
	primaryColor?: string;
	/** Primary text color on primary background */
	primaryForeground?: string;
	/** Chat panel background */
	backgroundColor?: string;
	/** Default text color */
	textColor?: string;
	/** Secondary/muted text */
	mutedColor?: string;
	/** Border color */
	borderColor?: string;
	/** Assistant message bubble background */
	assistantBubbleColor?: string;
	/** User message bubble background */
	userBubbleColor?: string;
	/** Input field background */
	inputBackgroundColor?: string;
	/** Border radius for the panel (px) */
	borderRadius?: number;
	/** Border radius for message bubbles (px) */
	messageBorderRadius?: number;
	/** Font family */
	fontFamily?: string;
	/** Header background color (card layout). Falls back to backgroundColor. */
	headerBackgroundColor?: string;
	/** Header text color. Falls back to textColor. */
	headerTextColor?: string;
	/** Status dot color. Defaults to green (#22c55e). */
	statusColor?: string;
	/** Tool call JSON section background. Defaults to light gray / #262626 in dark. */
	toolCardColor?: string;
}

// ============================================================================
// Welcome Screen
// ============================================================================

export interface WelcomeConfig {
	/** Icon displayed above the title. Accepts any React node (e.g. an SVG or img). */
	icon?: React.ReactNode;
	/** Title text shown prominently in the welcome screen. */
	title: string;
	/** Description text shown below the title. */
	description?: string;
	/** Suggestion cards shown in the welcome screen. Disappear after the first message. */
	suggestions?: string[];
}

// ============================================================================
// Suggestions
// ============================================================================

export interface SuggestionsConfig {
	/**
	 * Initial suggestions to show before the user sends their first message.
	 * Defaults to an empty array.
	 */
	initial?: string[];
	/**
	 * Enable AI-generated suggestions after each response.
	 * Defaults to `true` when suggestions config is provided.
	 */
	dynamic?: boolean;
}

// ============================================================================
// Shared Base Props
// ============================================================================

export interface ChatBaseProps {
	/** WaniWani project API key */
	apiKey?: string;
	/** Chat API endpoint URL. Defaults to WaniWani hosted endpoint */
	api?: string;
	/** Pre-loaded messages to display when the chat mounts. */
	initialMessages?: import("ai").UIMessage[];

	/** Initial greeting shown before user types */
	welcomeMessage?: string;
	/**
	 * Rich welcome screen shown when the conversation is empty.
	 * Replaces `welcomeMessage` with a centered layout featuring an icon, title,
	 * description, and card-style suggestion prompts.
	 * Takes precedence over `welcomeMessage` when provided.
	 */
	welcome?: WelcomeConfig;
	/** Theme overrides */
	theme?: ChatTheme;
	/** Additional headers to send with chat API requests */
	headers?: Record<string, string>;
	/** Additional body fields to send with each chat request */
	body?: Record<string, unknown>;
	/** Enable file attachments in the input. Defaults to false. */
	allowAttachments?: boolean;
	/** Placeholder text shown in the input field. Defaults to "Ask me anything...". Animates with a typing effect. */
	placeholder?: string;
	/**
	 * Name of a custom DOM event to listen for that triggers focus (scroll + glow) and optionally sends a message.
	 * Dispatch via `new CustomEvent('triggerDemoRequest', { detail: { message: 'Hi!' } })`.
	 * Set to `false` to disable. Defaults to `"triggerDemoRequest"`.
	 */
	triggerEvent?: string | false;
	/** Callback fired when a message is sent */
	onMessageSent?: (message: string) => void;
	/** Callback fired when a response is received */
	onResponseReceived?: () => void;
	/**
	 * Enable AI-generated suggestions after each response.
	 * `true` enables with defaults (3 suggestions), object allows config, `false`/undefined disables.
	 */
	suggestions?: boolean | SuggestionsConfig;
	/**
	 * Handler for MCP tool calls from widgets.
	 * Called when a widget uses `callServerTool` (MCP Apps standard).
	 * If not provided, defaults to POSTing to `${api}/tool`.
	 */
	onCallTool?: CallToolHandler;
	/**
	 * Enable debug mode. When true, the `_meta` field is shown in tool call
	 * inputs and outputs instead of being filtered out.
	 * Tip: set to `process.env.NEXT_PUBLIC_WANIWANI_DEBUG === '1'` to mirror
	 * the server-side `WANIWANI_DEBUG` env var.
	 */
	debug?: boolean;
	/**
	 * Skip fetching `/config` and `/tools` from the API on mount.
	 * Use when the chat endpoint doesn't serve these routes (e.g. embed widgets
	 * talking directly to the WaniWani app).
	 * @internal
	 */
	skipRemoteConfig?: boolean;
}

// ============================================================================
// ChatBar Props (compact bar that expands upward)
// ============================================================================

export interface ChatBarProps extends ChatBaseProps {
	/** Chat bar width in pixels. Defaults to 600. */
	width?: number;
	/** Width of the expanded card in pixels. Defaults to width × 1.2. */
	expandedWidth?: number;
	/** Max height of the expanded messages panel in pixels. Defaults to 400. */
	expandedHeight?: number;
	/** Title shown in the header when expanded. Defaults to "Assistant". */
	title?: string;
}

// ============================================================================
// ChatEmbed Props (standalone, bring-your-own-backend chat)
// ============================================================================

/**
 * MCP Apps configuration for {@link ChatEmbedProps}.
 *
 * Only needed when your backend proxies an MCP server whose tools return
 * widget metadata (`_meta.ui.resourceUri`). Without this, tool calls still
 * render with collapsible input/output — just no iframe widgets.
 */
export interface ChatEmbedMcpConfig {
	/** Endpoint that serves MCP app resources (HTML widgets). Called as `GET ${resourceEndpoint}?uri=...`. */
	resourceEndpoint: string;
	/**
	 * Handler for MCP tool calls triggered by widgets via `callServerTool`.
	 * If not provided, widget-initiated tool calls will be ignored.
	 */
	onCallTool?: CallToolHandler;
}

/** Handler signature for MCP tool calls from widgets. */
export type CallToolHandler = (params: {
	name: string;
	arguments: Record<string, unknown>;
}) => Promise<{
	content?: Array<{ type: string; text?: string }>;
	structuredContent?: Record<string, unknown>;
	_meta?: Record<string, unknown>;
}>;

/**
 * Standalone, borderless chat component designed for embedding into existing pages.
 *
 * Unlike {@link ChatCardProps} and {@link ChatBarProps}, ChatEmbed does **not** rely on
 * the WaniWani hosted backend. It does not fetch `/config` or call `/tool` — you bring
 * your own `api` endpoint.
 *
 * The component fills its parent container (`width: 100%; height: 100%`) with no
 * header, border, or shadow — making it ideal for integrating into an existing layout
 * that already provides its own chrome.
 *
 * To enable MCP App widgets (iframes), pass the optional `mcp` config.
 *
 * @example
 * ```tsx
 * // Basic — no MCP Apps
 * <ChatEmbed
 *   api="/api/my-chat-endpoint"
 *   body={{ environmentId, sessionId }}
 *   theme={{ backgroundColor: "#fff" }}
 * />
 *
 * // With MCP Apps support
 * <ChatEmbed
 *   api="/api/my-chat-endpoint"
 *   mcp={{ resourceEndpoint: "/api/mcp/resource" }}
 * />
 * ```
 */
export interface ChatEmbedProps
	extends Omit<ChatBaseProps, "api" | "onCallTool"> {
	/** The chat API endpoint URL. Required — there is no default. */
	api: string;
	/** Additional class names applied to the root element (e.g. Tailwind classes). */
	className?: string;
	/** MCP Apps configuration. Only needed if your backend serves widget resources. */
	mcp?: ChatEmbedMcpConfig;
	/** Hide the input bar at the bottom, making the chat read-only. */
	readOnly?: boolean;
}

// ============================================================================
// ChatCard Props (always-visible card with header)
// ============================================================================

export interface ChatCardProps extends ChatBaseProps {
	/** Title shown in the card header. Defaults to "Assistant". */
	title?: string;
	/** Subtitle or status text shown under the title. */
	subtitle?: string;
	/** Show the status dot in the header. Defaults to true. */
	showStatus?: boolean;
	/** Card width. Accepts a pixel number or any CSS value (e.g. "100%", "50vw"). Defaults to 500. */
	width?: number | string;
	/** Card height. Accepts a pixel number or any CSS value (e.g. "100%", "80vh"). Defaults to 600. */
	height?: number | string;
	/** Additional class names applied to the root element (e.g. Tailwind classes). */
	className?: string;
}

// ============================================================================
// Backward Compatibility
// ============================================================================

// ============================================================================
// Imperative Handle (ref API)
// ============================================================================

export interface ChatHandle {
	/** Programmatically send a user message into the chat */
	sendMessage: (text: string) => void;
	/**
	 * Send a user message and wait for the assistant response to complete.
	 * Returns the final assistant message. Useful for eval/testing flows.
	 */
	sendMessageAndWait: (text: string) => Promise<unknown>;
	/** Clear all messages and start a fresh conversation */
	reset: () => void;
	/** Scroll to the chat input, focus it, and show a highlight glow */
	focus: () => void;
	/** Current chat messages */
	messages: import("ai").UIMessage[];
}

// ============================================================================
// Backward Compatibility
// ============================================================================

/** @deprecated Use ChatBarProps instead */
export type ChatWidgetProps = ChatBarProps;
