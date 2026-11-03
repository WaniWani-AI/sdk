/**
 * WebMCP: the site's own tools, callable by a browsing agent standing on the
 * page.
 *
 * A third surface alongside the connector and the chat bubble, running the same
 * flows against the same server. The pieces split by who can see the browser:
 * the bridge and the widget payload here are the page's, shared by the SDK and
 * the chat. The widget-step resolution is the server's, and stays in the SDK
 * (`packages/sdk/src/webmcp/widget-step.ts`).
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
