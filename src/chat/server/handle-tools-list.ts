// Handle Tools List - Returns the MCP server's tool catalog including per-tool
// `_meta`, so the chat UI can cache it in the browser and resolve widget
// binding (`_meta.ui.resourceUri`, `_meta["openai/outputTemplate"]`, etc.) by
// tool name at render time.
//
// This mirrors the pattern used by MCPJam's `/api/web/tools/list` route and
// matches the MCP Apps spec ("hosts identify UI-enabled tools through
// `_meta.ui.resourceUri` metadata on the tool definition"). Kept as an
// ephemeral operation — one MCP client per HTTP request — so it works on
// serverless platforms without sticky sessions.

import { WaniWaniError } from "../../error";
import { createLogger } from "../../utils/logger.js";
import type { ResourceHandlerDeps } from "./@types";

/** Shape returned to the browser. Matches the MCP `tools/list` response. */
export interface HandleToolsListResponse {
	tools: Array<{
		name: string;
		title?: string;
		description?: string;
		inputSchema?: unknown;
		outputSchema?: unknown;
		annotations?: unknown;
		_meta?: Record<string, unknown>;
	}>;
	nextCursor?: string;
}

export function createToolsListHandler(deps: ResourceHandlerDeps) {
	const { mcpServerUrl: mcpServerUrlOverride, resolveConfig, debug } = deps;

	const log = createLogger("tools-list", debug);

	return async function handleToolsList(): Promise<Response> {
		log("→ GET tools/list");
		try {
			const mcpServerUrl =
				mcpServerUrlOverride ?? (await resolveConfig()).mcpServerUrl;
			log("mcpServerUrl:", mcpServerUrl);

			// Dynamic imports — these are optional peer dependencies
			let createMCPClient: typeof import("@ai-sdk/mcp")["createMCPClient"];
			let StreamableHTTPClientTransport: typeof import("@modelcontextprotocol/sdk/client/streamableHttp.js")["StreamableHTTPClientTransport"];

			try {
				[{ createMCPClient }, { StreamableHTTPClientTransport }] =
					await Promise.all([
						import("@ai-sdk/mcp"),
						import("@modelcontextprotocol/sdk/client/streamableHttp.js"),
					]);
				log("MCP deps loaded");
			} catch (importError) {
				console.error(
					"[waniwani:tools-list] MCP deps import failed:",
					importError,
				);
				return Response.json(
					{
						error:
							"MCP tools list handler requires @ai-sdk/mcp and @modelcontextprotocol/sdk. Install them to enable tool discovery.",
					},
					{ status: 501 },
				);
			}

			log("creating MCP client for", mcpServerUrl);
			const mcp = await createMCPClient({
				transport: new StreamableHTTPClientTransport(new URL(mcpServerUrl)),
			});

			try {
				log("listing tools");
				const result = await mcp.listTools();
				log("tools count:", result.tools.length);

				const response: HandleToolsListResponse = {
					tools: result.tools.map((tool) => ({
						name: tool.name,
						...(tool.title !== undefined && { title: tool.title }),
						...(tool.description !== undefined && {
							description: tool.description,
						}),
						...(tool.inputSchema !== undefined && {
							inputSchema: tool.inputSchema,
						}),
						...(tool.outputSchema !== undefined && {
							outputSchema: tool.outputSchema,
						}),
						...(tool.annotations !== undefined && {
							annotations: tool.annotations,
						}),
						...(tool._meta !== undefined && { _meta: tool._meta }),
					})),
					...(result.nextCursor !== undefined && {
						nextCursor: result.nextCursor,
					}),
				};

				log("← 200");
				return Response.json(response, {
					headers: {
						// Catalog can be safely cached briefly. Browsers get a fresh
						// copy per ChatCard mount but don't hammer the MCP server
						// when the user refreshes quickly.
						"Cache-Control": "private, max-age=60",
					},
				});
			} finally {
				await mcp.close();
				log("MCP client closed");
			}
		} catch (error) {
			console.error("[waniwani:tools-list] handler error:", error);
			const message =
				error instanceof Error ? error.message : "Unknown error occurred";
			const status = error instanceof WaniWaniError ? error.status : 500;
			log("← returning", status, "from caught error");
			return Response.json({ error: message }, { status });
		}
	};
}
