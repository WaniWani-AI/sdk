// Server-side MCP framework

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
	ConditionFn,
	FlowConfig,
	FlowTestResult,
	InferFlowState,
	InterruptSignal,
	NodeContext,
	NodeHandler,
	RegisteredFlow,
	TypedInterrupt,
	TypedShowWidget,
	WidgetSignal,
} from "./server/flows";
export {
	createFlow,
	createFlowTestHarness,
	END,
	START,
	StateGraph,
} from "./server/flows";
// Handler
export type { CreateMcpHandlerOptions } from "./server/handler";
export { createMcpHandler } from "./server/handler";
// Generic key-value store
export type { KvStore } from "./server/kv";
export { WaniwaniKvStore } from "./server/kv";
export type {
	RegisteredResource,
	ResourceConfig,
	WidgetCSP,
} from "./server/resources";
// Resources
export { createResource } from "./server/resources";
// Scoped client
export type { ScopedWaniWaniClient } from "./server/scoped-client";
// Tool creation
export { createTool, registerTools } from "./server/tools/create-tool";
// Types
export type {
	McpServer,
	RegisteredTool,
	ToolConfig,
	ToolHandler,
	ToolHandlerContext,
	ToolToolCallback,
	ZodRawShapeCompat,
} from "./server/tools/types";
// Tracking helpers
export type { TrackingRouteOptions } from "./server/tracking-route";
export { createTrackingRoute } from "./server/tracking-route";
export type { WithWaniwaniOptions } from "./server/with-waniwani/index";
export { withWaniwani } from "./server/with-waniwani/index";
