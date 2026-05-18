// ============================================================================
// Chat Theme
// ============================================================================

import type { ChatAppearance } from "./embed/config";

export type { ChatAppearance, ThemePreset } from "./embed/config";

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
	/**
	 * Theme preset (`light`/`dark`/`auto`) plus per-property overrides.
	 * See `ChatAppearance` for the shape.
	 */
	appearance?: ChatAppearance;
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
	 * Show tool call details (request/response panels). When `false`, each
	 * tool call renders as a compact indicator so the user can still tell
	 * the agent is doing something, but the JSON panels are hidden.
	 * MCP App widgets attached to a tool call are always rendered.
	 * Defaults to `true`.
	 */
	showToolCalls?: boolean;
	/**
	 * Skip fetching `/config` and `/tools` from the API on mount.
	 * Use when the chat endpoint doesn't serve these routes (e.g. embed widgets
	 * talking directly to the WaniWani app).
	 * @internal
	 */
	skipRemoteConfig?: boolean;
	/**
	 * Persist the conversation across page reloads using IndexedDB so the user
	 * can resume previous threads. Defaults to `false` — opt in explicitly.
	 */
	enableThreadHistory?: boolean;
	/**
	 * Force a specific thread to be active. When provided, the embed renders
	 * that thread's messages and ignores the most-recently-updated default.
	 */
	activeThreadId?: string;
	/** Fired whenever the active thread changes (new chat, switch, delete). */
	onThreadChange?: (threadId: string) => void;
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
 * **Advanced / bare-bones primitive.** Most apps should use
 * `WaniwaniChat` instead — it wires up the hosted WaniWani backend
 * (`app.waniwani.ai`) from a single `wwp_...` token and applies the
 * dashboard's display config automatically.
 *
 * `ChatEmbed` is the unmanaged escape hatch: you bring your own `api`
 * endpoint, your own auth headers, your own theme, and your own
 * (optional) MCP resource endpoint for widgets. Nothing is fetched or
 * defaulted for you — `skipRemoteConfig` is implied by the BYO design.
 * Reach for it when:
 *
 * - You self-host the chat backend (Next.js/Express route, your own
 *   provider) and don't want WaniWani's hosted features.
 * - You need full control over headers, body, and tool-call dispatch.
 *
 * The component fills its parent container (`width: 100%; height: 100%`)
 * with no header, border, or shadow.
 *
 * @example
 * ```tsx
 * // Self-hosted chat endpoint, no MCP App widgets
 * <ChatEmbed
 *   api="/api/my-chat-endpoint"
 *   body={{ environmentId, sessionId }}
 *   appearance={{ theme: "dark" }}
 * />
 *
 * // Self-hosted chat endpoint with MCP App widgets
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
	/**
	 * Sticky header title. When set (or when `enableThreadHistory` is true, or
	 * `headerActions` is provided), a sticky header is rendered at the top of
	 * the chat. Without any of these, the chat is headerless.
	 */
	title?: string;
	/** Extra React node rendered in the sticky header, right of the title. */
	headerActions?: React.ReactNode;
}

// `ChatCardProps` moved to `src/legacy/chat/web/chat-card.tsx` alongside the
// `ChatCard` component. Still re-exported from `@waniwani/sdk/chat` for
// back-compat — see `index.ts`.

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
