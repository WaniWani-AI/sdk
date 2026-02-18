// Server-side MCP widget framework

// Platform detection
export type { WidgetPlatform } from "./react/widgets/platform";
export { detectPlatform, isMCPApps, isOpenAI } from "./react/widgets/platform";
// Widget client types (for type-sharing between server and client)
export type {
	HostContext,
	ToolCallResult,
	ToolResult,
	UnifiedWidgetClient,
} from "./react/widgets/widget-client";
// Flow framework
export type {
	CompileOptions,
	ConditionFn,
	FlowConfig,
	InterruptSignal,
	NodeHandler,
	RegisteredFlow,
	WidgetSignal,
} from "./server/flows";
export {
	createFlow,
	END,
	interrupt,
	START,
	StateGraph,
	showWidget,
} from "./server/flows";
// Widget creation
export { createWidget, registerWidgets } from "./server/widgets/create-widget";
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
} from "./server/widgets/types";
