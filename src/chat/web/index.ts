// Chat Widget Module - Client-side React components

// Back-compat re-export. `ChatCard` lives in `@waniwani/sdk/legacy` going
// forward — this re-export will be removed in a future minor release.
// New code should use `WaniwaniChat` (hosted) or `ChatEmbed` (BYO backend).
/** @deprecated Import from `@waniwani/sdk/legacy` and migrate to `WaniwaniChat`. */
export {
	ChatCard,
	type ChatCardProps,
} from "../../legacy/chat/web/chat-card";
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
export type { WidgetEvent, WidgetEventName } from "./embed/widget-events";
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
