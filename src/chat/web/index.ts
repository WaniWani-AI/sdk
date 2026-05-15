// Chat Widget Module - Client-side React components

export type {
	ChatBaseProps,
	ChatCardProps,
	ChatEmbedMcpConfig,
	ChatEmbedProps,
	ChatHandle,
	ChatTheme,
	SuggestionsConfig,
	WelcomeConfig,
} from "./@types";
export type {
	McpAppDisplayMode,
	McpAppFrameProps,
} from "./components/mcp-app-frame";
export { McpAppFrame } from "./components/mcp-app-frame";
export { ChatCard } from "./layouts/chat-card";
export { ChatEmbed } from "./layouts/chat-embed";
export {
	DARK_THEME,
	DEFAULT_THEME,
	mergeTheme,
	themeToCSSProperties,
} from "./theme";
