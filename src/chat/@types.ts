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
// Shared Base Props
// ============================================================================

export interface ChatBaseProps {
	/** WaniWani project API key */
	apiKey?: string;
	/** Chat API endpoint URL. Defaults to WaniWani hosted endpoint */
	api?: string;
	/** Initial greeting shown before user types */
	welcomeMessage?: string;
	/** Theme overrides */
	theme?: ChatTheme;
	/** Additional headers to send with chat API requests */
	headers?: Record<string, string>;
	/** Additional body fields to send with each chat request */
	body?: Record<string, unknown>;
	/** Enable file attachments in the input. Defaults to false. */
	allowAttachments?: boolean;
	/** Callback fired when a message is sent */
	onMessageSent?: (message: string) => void;
	/** Callback fired when a response is received */
	onResponseReceived?: () => void;
	/** Endpoint URL for fetching MCP app resources (HTML widgets). Defaults to "/api/mcp/resource" */
	resourceEndpoint?: string;
}

// ============================================================================
// ChatBar Props (compact bar that expands upward)
// ============================================================================

export interface ChatBarProps extends ChatBaseProps {
	/** Chat bar width in pixels. Defaults to 600. */
	width?: number;
	/** Max height of the expanded messages panel in pixels. Defaults to 400. */
	expandedHeight?: number;
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
	/** Card width in pixels. Defaults to 400. */
	width?: number;
	/** Card height in pixels. Defaults to 600. */
	height?: number;
}

// ============================================================================
// Backward Compatibility
// ============================================================================

/** @deprecated Use ChatBarProps instead */
export type ChatWidgetProps = ChatBarProps;
