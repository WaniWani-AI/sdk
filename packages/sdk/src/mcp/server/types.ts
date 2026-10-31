/**
 * Shared MCP server types — re-exports from `@modelcontextprotocol/sdk` so
 * non-legacy code (flows, withWaniwani, tracking) and legacy code (createTool,
 * createResource) can share the same type surface without depending on legacy
 * paths.
 */

export type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
export type { ZodRawShapeCompat } from "@modelcontextprotocol/sdk/server/zod-compat.js";
