import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerHelloTool } from "./hello";

/**
 * Registers all tools on the MCP server.
 *
 * To add a new tool:
 * 1. Create the tool file in this directory
 * 2. Import the register function above
 * 3. Call it in registerAllTools below
 */
export function registerAllTools(server: McpServer): void {
  registerHelloTool(server);
}
