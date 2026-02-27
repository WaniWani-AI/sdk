import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/**
 * Register the hello tool
 *
 * Returns a friendly greeting. Use this to greet users by name.
 */
export function registerHelloTool(server: McpServer) {
  server.registerTool(
    "hello",
    {
      description: "Returns a friendly greeting. Use this to greet users by name.",
      inputSchema: {
        name: z.string().optional().describe("Name to greet (optional)"),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
        destructiveHint: false,
      },
    },
    async (args) => {
      const greeting = args.name ? `Hello, ${args.name}!` : "Hello, world!";
      return {
        content: [{ type: "text", text: greeting }],
      };
    }
  );
}
