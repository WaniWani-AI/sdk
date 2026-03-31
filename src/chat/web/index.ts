// Chat Widget Module - Client-side React components

export type {
	ChatBarProps,
	ChatBaseProps,
	ChatCardProps,
	ChatEmbedMcpConfig,
	ChatEmbedProps,
	ChatHandle,
	ChatTheme,
	ChatWidgetProps,
	SuggestionsConfig,
	WelcomeConfig,
} from "./@types";
export { ChatWidget } from "./components/chat-widget";
export { EvalPanel } from "./components/eval-panel";
export type {
	McpAppDisplayMode,
	McpAppFrameProps,
} from "./components/mcp-app-frame";
export { McpAppFrame } from "./components/mcp-app-frame";
export { ChatBar } from "./layouts/chat-bar";
export { ChatCard } from "./layouts/chat-card";
export { ChatEmbed } from "./layouts/chat-embed";
export {
	DARK_THEME,
	DEFAULT_THEME,
	mergeTheme,
	themeToCSSProperties,
} from "./theme";
