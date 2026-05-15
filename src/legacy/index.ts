// Legacy SDK surface, mounted at `@waniwani/sdk/legacy`. Bundles the
// MCP-widget-in-host primitives (createTool, createResource, WidgetProvider,
// the host bridge hooks, platform detection) and the chat-server Next.js
// adapter that customer MCPs originally built against.
//
// Express adapter is intentionally NOT re-exported here — it imports
// `node:stream` at module scope, which breaks browser bundles that resolve
// `@waniwani/sdk/legacy`. Import it from `@waniwani/sdk/legacy/express-js`.
//
// New code should not use any of this — use `createFlow` from
// `@waniwani/sdk/mcp` instead. The exports stay alive indefinitely for
// customer MCPs already on this stack.

// ----------------------------------------------------------------------------
// Server-side MCP primitives
// ----------------------------------------------------------------------------

// Resources
export type {
	RegisteredResource,
	ResourceConfig,
	WidgetCSP,
} from "./mcp/resources";
export { createResource } from "./mcp/resources";
// Tool creation
export { createTool, registerTools } from "./mcp/tools/create-tool";
export type {
	McpServer,
	RegisteredTool,
	ToolConfig,
	ToolHandler,
	ToolHandlerContext,
	ToolToolCallback,
	ZodRawShapeCompat,
} from "./mcp/tools/types";

// ----------------------------------------------------------------------------
// Client-side MCP-widget React surface
// ----------------------------------------------------------------------------

export * from "./mcp/react";

// ----------------------------------------------------------------------------
// Chat-server Next.js adapter
// ----------------------------------------------------------------------------

export * from "./chat/next-js";
