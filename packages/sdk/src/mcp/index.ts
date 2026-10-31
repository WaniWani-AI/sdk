// Server-side MCP framework

// ----------------------------------------------------------------------------
// OSS / Free Tier (non-legacy) — recommended for all new code
// ----------------------------------------------------------------------------

// Widget/view binding, shared with the chat surface — OSS
export type { MetaCarrier } from "@waniwani/protocol/shared/view-uri";
export {
	autoHeightFromMeta,
	isDisplayTool,
	resourceUriFromMeta,
	viewUriFor,
} from "@waniwani/protocol/shared/view-uri";
// WebMCP — the site's tools, callable by a browsing agent on the page. OSS.
export type {
	WebMcpBridge,
	WebMcpBridgeOptions,
	WebMcpCallResponse,
	WebMcpCallResult,
	WebMcpContentBlock,
	WebMcpListResponse,
	WebMcpPageContext,
	WebMcpRequest,
	WebMcpTool,
	WebMcpWidgetPayload,
} from "@waniwani/protocol/webmcp";
export {
	createWebMcpBridge,
	supportsWebMcp,
} from "@waniwani/protocol/webmcp";
export type { WidgetStep, WidgetStepStatus } from "../webmcp/widget-step";
export { readWidgetStep, rewriteForAgent } from "../webmcp/widget-step";
// Flow framework — OSS
export type {
	AddNodeConfig,
	ConditionFn,
	FlowConfig,
	FlowIntro,
	FlowIntroPayload,
	FlowTestResult,
	InferFlowState,
	InterruptSignal,
	NodeContext,
	NodeHandler,
	RegisteredFlow,
	RegisteredTool,
	TypedInterrupt,
	TypedShowWidget,
	WidgetSignal,
} from "./server/flows";
export {
	createFlow,
	createFlowTestHarness,
	END,
	neverPrefilled,
	redacted,
	START,
	StateGraph,
} from "./server/flows";
// Generic key-value store — OSS interface, free-tier hosted impl
export type { KvStore, KvStoreSetOptions } from "./server/kv";
export { MemoryKvStore, WaniwaniKvStore } from "./server/kv";
export type { ScopedWaniWaniClient } from "./server/scoped-client";
export { extractScopedClient, SCOPED_CLIENT_KEY } from "./server/scoped-client";
// Tracking helpers — free tier
export type { TrackingRouteOptions } from "./server/tracking-route";
export { createTrackingRoute } from "./server/tracking-route";
// Shared MCP server types (non-legacy)
export type { McpServer, ZodRawShapeCompat } from "./server/types";
// Scoped client — free tier (used inside withWaniwani-wrapped tools)
export type { AttachedDocument, AttachedFile } from "./server/utils";
export type { WithWaniwaniOptions } from "./server/with-waniwani/index";
export { withWaniwani } from "./server/with-waniwani/index";
export type {
	CaptureIntentOptions,
	ToolTelemetry,
} from "./server/with-waniwani/intent-capture";
