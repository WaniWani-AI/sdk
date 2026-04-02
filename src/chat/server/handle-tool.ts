// Handle Tool - Calls MCP server tools directly and returns JSON results

import { WaniWaniError } from "../../error";
import { createLogger } from "../../utils/logger.js";
import type { ResourceHandlerDeps } from "./@types";

export function createToolHandler(deps: ResourceHandlerDeps) {
	const {
		mcpServerUrl: mcpServerUrlOverride,
		resolveConfig,
		debug,
		source,
	} = deps;

	const log = createLogger("tool", debug);

	return async function handleTool(request: Request): Promise<Response> {
		log("→ POST", request.url);
		try {
			const body = await request.json();
			const { name, arguments: args } = body as {
				name: string;
				arguments: Record<string, unknown>;
			};
			const requestSessionId = request.headers.get("x-session-id")?.trim();

			if (!name || typeof name !== "string") {
				log("← 400 missing tool name");
				return Response.json({ error: "Missing tool name" }, { status: 400 });
			}

			log(
				"tool:",
				name,
				"args:",
				JSON.stringify(args),
				"sessionId:",
				requestSessionId || "(none)",
			);

			const mcpServerUrl =
				mcpServerUrlOverride ?? (await resolveConfig()).mcpServerUrl;
			log("mcpServerUrl:", mcpServerUrl);

			// Dynamic imports — these are optional peer dependencies
			let Client: typeof import("@modelcontextprotocol/sdk/client/index.js")["Client"];
			let StreamableHTTPClientTransport: typeof import("@modelcontextprotocol/sdk/client/streamableHttp.js")["StreamableHTTPClientTransport"];

			try {
				[{ Client }, { StreamableHTTPClientTransport }] = await Promise.all([
					import("@modelcontextprotocol/sdk/client/index.js"),
					import("@modelcontextprotocol/sdk/client/streamableHttp.js"),
				]);
				log("MCP deps loaded");
			} catch (importError) {
				console.error("[waniwani:tool] MCP deps import failed:", importError);
				return Response.json(
					{
						error:
							"MCP tool handler requires @modelcontextprotocol/sdk. Install it to enable tool calls.",
					},
					{ status: 501 },
				);
			}

			log("creating MCP client for", mcpServerUrl);
			const transport = new StreamableHTTPClientTransport(
				new URL(mcpServerUrl),
			);
			const client = new Client({
				name: "waniwani-tool-caller",
				version: "1.0.0",
			});
			await client.connect(transport);

			try {
				log("calling tool:", name);
				const _meta: Record<string, unknown> = {};
				if (requestSessionId) {
					_meta["waniwani/sessionId"] = requestSessionId;
				}
				if (source) {
					_meta["waniwani/source"] = source;
				}
				const result = await client.callTool({
					name,
					arguments: args ?? {},
					...(Object.keys(_meta).length > 0 ? { _meta } : {}),
				} as {
					name: string;
					arguments: Record<string, unknown>;
					_meta?: Record<string, unknown>;
				});
				log("tool result received");

				return Response.json({
					content: result.content,
					structuredContent: result.structuredContent,
					_meta: result._meta,
					isError: result.isError,
				});
			} finally {
				await client.close();
				log("MCP client closed");
			}
		} catch (error) {
			console.error("[waniwani:tool] handler error:", error);
			const message =
				error instanceof Error ? error.message : "Unknown error occurred";
			const status = error instanceof WaniWaniError ? error.status : 500;
			log("← returning", status, "from caught error");
			return Response.json({ error: message }, { status });
		}
	};
}
