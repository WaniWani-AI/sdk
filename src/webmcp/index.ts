/**
 * WebMCP: the site's own tools, callable by a browsing agent standing on the
 * page.
 *
 * A third surface alongside the connector and the chat bubble, running the same
 * flows against the same server. The pieces split by who can see the browser:
 * the bridge and the widget payload are the page's, and the resolution below is
 * the server's, imported by whatever mounts the HTTP endpoints.
 *
 * OSS tier. Nothing here needs an API key.
 */

export type {
	WebMcpCallResponse,
	WebMcpCallResult,
	WebMcpContentBlock,
	WebMcpListResponse,
	WebMcpPageContext,
	WebMcpRequest,
	WebMcpTool,
	WebMcpWidgetPayload,
} from "./@types";
export type { WebMcpBridge, WebMcpBridgeOptions } from "./bridge";
export { createWebMcpBridge, supportsWebMcp } from "./bridge";
export type { WidgetStep, WidgetStepStatus } from "./widget-step";
export { readWidgetStep, rewriteForAgent } from "./widget-step";
