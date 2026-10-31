// `@waniwani/sdk/chat` moved to its own package, `@waniwani/chat`. This entry
// re-exports it so existing imports keep working until 0.28.0, which removes
// it. `@waniwani/chat` is an optional peer: install it next to the SDK.
//
// Each symbol is re-declared, not re-exported, because an editor shows
// `@deprecated` on a declaration but not on an `export { … } from` specifier.

import type * as Chat from "@waniwani/chat";
import {
	ChatEmbed as ChatEmbedImpl,
	DARK_THEME as DARK_THEME_IMPL,
	DEFAULT_THEME as DEFAULT_THEME_IMPL,
	McpAppFrame as McpAppFrameImpl,
	mergeTheme as mergeThemeImpl,
	themeToCSSProperties as themeToCSSPropertiesImpl,
	WaniwaniChat as WaniwaniChatImpl,
	WebMcpOverlay as WebMcpOverlayImpl,
} from "@waniwani/chat";

/** @deprecated Import `WaniwaniChat` from `@waniwani/chat`. `@waniwani/sdk/chat` is removed in 0.28.0. */
export const WaniwaniChat = WaniwaniChatImpl;
/** @deprecated Import `ChatEmbed` from `@waniwani/chat`. `@waniwani/sdk/chat` is removed in 0.28.0. */
export const ChatEmbed = ChatEmbedImpl;
/** @deprecated Import `McpAppFrame` from `@waniwani/chat`. `@waniwani/sdk/chat` is removed in 0.28.0. */
export const McpAppFrame = McpAppFrameImpl;
/** @deprecated Import `WebMcpOverlay` from `@waniwani/chat`. `@waniwani/sdk/chat` is removed in 0.28.0. */
export const WebMcpOverlay = WebMcpOverlayImpl;
/** @deprecated Import `DEFAULT_THEME` from `@waniwani/chat`. `@waniwani/sdk/chat` is removed in 0.28.0. */
export const DEFAULT_THEME = DEFAULT_THEME_IMPL;
/** @deprecated Import `DARK_THEME` from `@waniwani/chat`. `@waniwani/sdk/chat` is removed in 0.28.0. */
export const DARK_THEME = DARK_THEME_IMPL;
/** @deprecated Import `mergeTheme` from `@waniwani/chat`. `@waniwani/sdk/chat` is removed in 0.28.0. */
export const mergeTheme = mergeThemeImpl;
/** @deprecated Import `themeToCSSProperties` from `@waniwani/chat`. `@waniwani/sdk/chat` is removed in 0.28.0. */
export const themeToCSSProperties = themeToCSSPropertiesImpl;

/** @deprecated Import `ChatAppearance` from `@waniwani/chat`. `@waniwani/sdk/chat` is removed in 0.28.0. */
export type ChatAppearance = Chat.ChatAppearance;
/** @deprecated Import `ChatBaseProps` from `@waniwani/chat`. `@waniwani/sdk/chat` is removed in 0.28.0. */
export type ChatBaseProps = Chat.ChatBaseProps;
/** @deprecated Import `ChatEmbedMcpConfig` from `@waniwani/chat`. `@waniwani/sdk/chat` is removed in 0.28.0. */
export type ChatEmbedMcpConfig = Chat.ChatEmbedMcpConfig;
/** @deprecated Import `ChatEmbedProps` from `@waniwani/chat`. `@waniwani/sdk/chat` is removed in 0.28.0. */
export type ChatEmbedProps = Chat.ChatEmbedProps;
/** @deprecated Import `ChatHandle` from `@waniwani/chat`. `@waniwani/sdk/chat` is removed in 0.28.0. */
export type ChatHandle = Chat.ChatHandle;
/** @deprecated Import `ChatTheme` from `@waniwani/chat`. `@waniwani/sdk/chat` is removed in 0.28.0. */
export type ChatTheme = Chat.ChatTheme;
/** @deprecated Import `ShowToolCalls` from `@waniwani/chat`. `@waniwani/sdk/chat` is removed in 0.28.0. */
export type ShowToolCalls = Chat.ShowToolCalls;
/** @deprecated Import `SuggestionsConfig` from `@waniwani/chat`. `@waniwani/sdk/chat` is removed in 0.28.0. */
export type SuggestionsConfig = Chat.SuggestionsConfig;
/** @deprecated Import `ThemePreset` from `@waniwani/chat`. `@waniwani/sdk/chat` is removed in 0.28.0. */
export type ThemePreset = Chat.ThemePreset;
/** @deprecated Import `WelcomeConfig` from `@waniwani/chat`. `@waniwani/sdk/chat` is removed in 0.28.0. */
export type WelcomeConfig = Chat.WelcomeConfig;
/** @deprecated Import `McpAppDisplayMode` from `@waniwani/chat`. `@waniwani/sdk/chat` is removed in 0.28.0. */
export type McpAppDisplayMode = Chat.McpAppDisplayMode;
/** @deprecated Import `McpAppFrameProps` from `@waniwani/chat`. `@waniwani/sdk/chat` is removed in 0.28.0. */
export type McpAppFrameProps = Chat.McpAppFrameProps;
/** @deprecated Import `WebMcpOverlayProps` from `@waniwani/chat`. `@waniwani/sdk/chat` is removed in 0.28.0. */
export type WebMcpOverlayProps = Chat.WebMcpOverlayProps;
/** @deprecated Import `WidgetEvent` from `@waniwani/chat`. `@waniwani/sdk/chat` is removed in 0.28.0. */
export type WidgetEvent = Chat.WidgetEvent;
/** @deprecated Import `WidgetEventName` from `@waniwani/chat`. `@waniwani/sdk/chat` is removed in 0.28.0. */
export type WidgetEventName = Chat.WidgetEventName;
/** @deprecated Import `WidgetMode` from `@waniwani/chat`. `@waniwani/sdk/chat` is removed in 0.28.0. */
export type WidgetMode = Chat.WidgetMode;
/** @deprecated Import `WaniwaniChatOverrides` from `@waniwani/chat`. `@waniwani/sdk/chat` is removed in 0.28.0. */
export type WaniwaniChatOverrides = Chat.WaniwaniChatOverrides;
/** @deprecated Import `WaniwaniChatProps` from `@waniwani/chat`. `@waniwani/sdk/chat` is removed in 0.28.0. */
export type WaniwaniChatProps = Chat.WaniwaniChatProps;
