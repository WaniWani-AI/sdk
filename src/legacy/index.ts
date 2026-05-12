// Legacy server-side MCP primitives. Mounted at `@waniwani/sdk/legacy`.
//
// These exports are also re-exported from `@waniwani/sdk/mcp` for back-compat.
// New code should not use these — use `createFlow` from `@waniwani/sdk/mcp`
// instead. The exports stay alive indefinitely for customer MCPs already on
// this stack.

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
