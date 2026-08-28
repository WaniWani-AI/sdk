// Server-side MCP framework

// ----------------------------------------------------------------------------
// OSS / Free Tier (non-legacy) — recommended for all new code
// ----------------------------------------------------------------------------

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
