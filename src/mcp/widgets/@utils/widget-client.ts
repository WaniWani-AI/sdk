import type {
	DisplayMode,
	SafeArea,
	Theme,
	UnknownObject,
} from "../../hooks/@types";

/**
 * Result from calling a tool
 */
export type ToolCallResult = {
	content?: Array<{ type: string; text?: string }>;
	structuredContent?: Record<string, unknown>;
};

/**
 * Tool result notification (what the host pushes to the widget)
 */
export type ToolResult = {
	content?: Array<{ type: string; text?: string }>;
	structuredContent?: Record<string, unknown>;
};

/**
 * Host context - all values available from the host.
 */
export type HostContext = {
	theme: Theme;
	locale: string;
	displayMode: DisplayMode;
	maxHeight: number | null;
	safeArea: SafeArea | null;
	toolOutput: UnknownObject | null;
	toolResponseMetadata: UnknownObject | null;
	widgetState: UnknownObject | null;
};

/**
 * Store interface for useSyncExternalStore compatibility.
 */
export type HostContextStore<K extends keyof HostContext> = {
	subscribe: (onStoreChange: () => void) => () => void;
	getSnapshot: () => HostContext[K];
};

/**
 * Unified widget client interface that works on both OpenAI and MCP Apps.
 *
 * Platform-specific behavior:
 * - Display mode: OpenAI-only. MCP Apps returns "inline" and requestDisplayMode is a no-op.
 * - Follow-up messages: Unified API, different underlying implementations.
 */
export interface UnifiedWidgetClient {
	/**
	 * Connect to the host. Must be called before using other methods.
	 * On OpenAI, this is a no-op (already connected via window.openai).
	 * On MCP Apps, this establishes the postMessage connection.
	 */
	connect(): Promise<void>;

	/**
	 * Get the tool output (structured content returned by the tool handler).
	 * This is the main data source for widget rendering.
	 */
	getToolOutput<T = Record<string, unknown>>(): T | null;

	/**
	 * Register a callback for when tool results are received.
	 * On OpenAI, this subscribes to toolOutput changes.
	 * On MCP Apps, this sets app.ontoolresult.
	 */
	onToolResult(callback: (result: ToolResult) => void): () => void;

	/**
	 * Call another tool on the server.
	 */
	callTool(
		name: string,
		args: Record<string, unknown>,
	): Promise<ToolCallResult>;

	/**
	 * Open an external URL.
	 * On OpenAI: openai.openExternal({ href })
	 * On MCP Apps: app.sendOpenLink(url)
	 */
	openExternal(url: string): void;

	/**
	 * Send a follow-up message to the AI.
	 * On OpenAI: openai.sendFollowUpMessage({ prompt })
	 * On MCP Apps: app.sendMessages([{ role: 'user', content: { type: 'text', text: prompt } }])
	 */
	sendFollowUp(prompt: string): void;

	/**
	 * Get the current theme.
	 */
	getTheme(): Theme;

	/**
	 * Subscribe to theme changes.
	 */
	onThemeChange(callback: (theme: Theme) => void): () => void;

	/**
	 * Get the current locale.
	 */
	getLocale(): string;

	/**
	 * Get the current display mode.
	 * OpenAI-only: returns "pip" | "inline" | "fullscreen"
	 * MCP Apps: always returns "inline"
	 */
	getDisplayMode(): DisplayMode;

	/**
	 * Request a display mode change.
	 * OpenAI-only: requests the mode from the host.
	 * MCP Apps: no-op (returns current mode).
	 */
	requestDisplayMode(mode: DisplayMode): Promise<DisplayMode>;

	/**
	 * Subscribe to display mode changes.
	 * OpenAI-only: subscribes to displayMode changes.
	 * MCP Apps: callback is never called.
	 */
	onDisplayModeChange(callback: (mode: DisplayMode) => void): () => void;

	/**
	 * Get the safe area insets.
	 * OpenAI-only: returns insets from window.openai.safeArea.
	 * MCP Apps: returns null.
	 */
	getSafeArea(): SafeArea | null;

	/**
	 * Subscribe to safe area changes.
	 * OpenAI-only: subscribes to safeArea changes.
	 * MCP Apps: callback is never called.
	 */
	onSafeAreaChange(callback: (safeArea: SafeArea | null) => void): () => void;

	/**
	 * Get the max height constraint.
	 * OpenAI-only: returns maxHeight from window.openai.maxHeight.
	 * MCP Apps: returns null.
	 */
	getMaxHeight(): number | null;

	/**
	 * Subscribe to max height changes.
	 * OpenAI-only: subscribes to maxHeight changes.
	 * MCP Apps: callback is never called.
	 */
	onMaxHeightChange(callback: (maxHeight: number | null) => void): () => void;

	/**
	 * Get the tool response metadata.
	 * OpenAI-only: returns metadata from window.openai.toolResponseMetadata.
	 * MCP Apps: returns null.
	 */
	getToolResponseMetadata(): UnknownObject | null;

	/**
	 * Subscribe to tool response metadata changes.
	 * OpenAI-only: subscribes to toolResponseMetadata changes.
	 * MCP Apps: callback is never called.
	 */
	onToolResponseMetadataChange(
		callback: (metadata: UnknownObject | null) => void,
	): () => void;

	/**
	 * Get the widget state.
	 * OpenAI-only: returns state from window.openai.widgetState.
	 * MCP Apps: returns null.
	 */
	getWidgetState(): UnknownObject | null;

	/**
	 * Subscribe to widget state changes.
	 * OpenAI-only: subscribes to widgetState changes.
	 * MCP Apps: callback is never called.
	 */
	onWidgetStateChange(
		callback: (state: UnknownObject | null) => void,
	): () => void;
}

/**
 * Creates a unified widget client for the current platform.
 */
export async function createWidgetClient(): Promise<UnifiedWidgetClient> {
	const { detectPlatform } = await import("./platform");
	const platform = detectPlatform();

	if (platform === "openai") {
		const { OpenAIWidgetClient } = await import("./openai-client");
		return new OpenAIWidgetClient();
	} else {
		const { MCPAppsWidgetClient } = await import("./mcp-apps-client");
		return new MCPAppsWidgetClient();
	}
}
