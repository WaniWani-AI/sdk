import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

export interface CreateMcpHandlerOptions {
	serverInfo?: { name: string; version: string };
	sessionIdGenerator?: () => string;
}

/**
 * Creates a stateless MCP request handler using the Web Standard transport.
 * Returns an async function `(request: Request) => Promise<Response>` suitable
 * for Next.js App Router, Cloudflare Workers, Bun, Deno, etc.
 */
export function createMcpHandler(
	init: (server: McpServer) => void | Promise<void>,
	options?: CreateMcpHandlerOptions,
): (request: Request) => Promise<Response> {
	return async (request: Request): Promise<Response> => {
		const transport = new WebStandardStreamableHTTPServerTransport({
			sessionIdGenerator: options?.sessionIdGenerator,
			enableJsonResponse: true,
		});

		const server = new McpServer(
			options?.serverInfo ?? { name: "mcp-server", version: "1.0.0" },
		);

		await init(server);
		await server.connect(transport);

		try {
			return await transport.handleRequest(request);
		} finally {
			await server.close();
		}
	};
}
