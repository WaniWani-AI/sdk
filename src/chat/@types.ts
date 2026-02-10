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
}

// ============================================================================
// Chat Widget Props (React component)
// ============================================================================

export interface ChatWidgetProps {
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
	/** Chat bar width in pixels. Defaults to 600. */
	width?: number;
	/** Max height of the expanded messages panel in pixels. Defaults to 400. */
	expandedHeight?: number;
	/** Enable file attachments in the input. Defaults to false. */
	allowAttachments?: boolean;
	/** Callback fired when a message is sent */
	onMessageSent?: (message: string) => void;
	/** Callback fired when a response is received */
	onResponseReceived?: () => void;
}
