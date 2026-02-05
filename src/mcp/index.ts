// Server-side MCP widget framework

// Widget creation
export { createWidget, registerWidgets } from "./widgets/@utils/create-widget";
export type { WidgetPlatform } from "./widgets/@utils/platform";

// Platform detection
export { detectPlatform, isMCPApps, isOpenAI } from "./widgets/@utils/platform";
// Types
export type {
	McpServer,
	RegisteredWidget,
	WidgetConfig,
	WidgetCSP,
	WidgetHandler,
	WidgetHandlerContext,
	WidgetToolCallback,
	ZodRawShapeCompat,
} from "./widgets/@utils/types";

// Widget client types (for type-sharing between server and client)
export type {
	HostContext,
	ToolCallResult,
	ToolResult,
	UnifiedWidgetClient,
} from "./widgets/@utils/widget-client";
