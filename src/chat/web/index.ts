// Chat Widget Module - Client-side React components

export type {
	ChatAppearance,
	ChatBaseProps,
	ChatEmbedMcpConfig,
	ChatEmbedProps,
	ChatHandle,
	ChatTheme,
	ShowToolCalls,
	SuggestionsConfig,
	ThemePreset,
	WelcomeConfig,
} from "./@types";
export type {
	McpAppDisplayMode,
	McpAppFrameProps,
} from "./components/mcp-app-frame";
export { McpAppFrame } from "./components/mcp-app-frame";
export type { WebMcpOverlayProps } from "./embed/webmcp-overlay";
export { WebMcpOverlay } from "./embed/webmcp-overlay";
export type {
	WidgetEvent,
	WidgetEventName,
	WidgetMode,
} from "./embed/widget-events";
export { ChatEmbed } from "./layouts/chat-embed";
export {
	WaniwaniChat,
	type WaniwaniChatOverrides,
	type WaniwaniChatProps,
} from "./layouts/waniwani-chat";
export {
	DARK_THEME,
	DEFAULT_THEME,
	mergeTheme,
	themeToCSSProperties,
} from "./theme";
