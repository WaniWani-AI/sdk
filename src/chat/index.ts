// Chat Widget Module - Client-side React components

export type {
	ChatBarProps,
	ChatBaseProps,
	ChatCardProps,
	ChatTheme,
	ChatWidgetProps,
} from "./@types";
export { ChatWidget } from "./components/chat-widget";
export type { McpAppFrameProps } from "./components/mcp-app-frame";
export { McpAppFrame } from "./components/mcp-app-frame";
export { ChatBar } from "./layouts/chat-bar";
export { ChatCard } from "./layouts/chat-card";
export {
	DARK_THEME,
	DEFAULT_THEME,
	mergeTheme,
	themeToCSSProperties,
} from "./theme";
