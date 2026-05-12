// Server-side MCP framework

// ----------------------------------------------------------------------------
// OSS / Free Tier (non-legacy) — recommended for all new code
// ----------------------------------------------------------------------------

// Flow framework — OSS
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
	redacted,
	START,
	StateGraph,
} from "./server/flows";
// Generic key-value store — OSS interface, free-tier hosted impl
export type { KvStore } from "./server/kv";
export { MemoryKvStore, WaniwaniKvStore } from "./server/kv";
// Scoped client — free tier (used inside withWaniwani-wrapped tools)
export type { ScopedWaniWaniClient } from "./server/scoped-client";
// Tracking helpers — free tier
export type { TrackingRouteOptions } from "./server/tracking-route";
export { createTrackingRoute } from "./server/tracking-route";
// Shared MCP server types (non-legacy)
export type { McpServer, ZodRawShapeCompat } from "./server/types";
export type { WithWaniwaniOptions } from "./server/with-waniwani/index";
export { withWaniwani } from "./server/with-waniwani/index";

// ----------------------------------------------------------------------------
// Legacy — preserved for back-compat. Prefer `@waniwani/sdk/legacy` for new code
// that still needs these primitives. These exports will be removed from
// `@waniwani/sdk/mcp` in a future major release.
// ----------------------------------------------------------------------------

// Platform detection (legacy widget host detection)
export type { WidgetPlatform } from "../legacy/mcp/react/widgets/platform";
export {
	detectPlatform,
	isMCPApps,
	isOpenAI,
} from "../legacy/mcp/react/widgets/platform";
// Widget client types (legacy)
export type {
	HostContext,
	ToolCallResult,
	ToolResult,
	UnifiedWidgetClient,
} from "../legacy/mcp/react/widgets/widget-client";
// Resources (legacy)
export type {
	RegisteredResource,
	ResourceConfig,
	WidgetCSP,
} from "../legacy/mcp/resources";
export { createResource } from "../legacy/mcp/resources";
// Tool creation (legacy)
export { createTool, registerTools } from "../legacy/mcp/tools/create-tool";
export type {
	RegisteredTool,
	ToolConfig,
	ToolHandler,
	ToolHandlerContext,
	ToolToolCallback,
} from "../legacy/mcp/tools/types";
