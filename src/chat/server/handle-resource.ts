// Handle Resource - Serves MCP resource content (HTML widgets)

import { WaniWaniError } from "../../error";
import type { ResourceHandlerDeps } from "./@types";

export function createResourceHandler(deps: ResourceHandlerDeps) {
	const { mcpServerUrl: mcpServerUrlOverride, resolveConfig } = deps;

	return async function handleResource(url: URL): Promise<Response> {
		try {
			const uri = url.searchParams.get("uri");

			if (!uri) {
				return Response.json(
					{ error: "Missing uri query parameter" },
					{ status: 400 },
				);
			}

			const mcpServerUrl =
				mcpServerUrlOverride ?? (await resolveConfig()).mcpServerUrl;

			// Dynamic imports — these are optional peer dependencies
			let createMCPClient: typeof import("@ai-sdk/mcp")["createMCPClient"];
			let StreamableHTTPClientTransport: typeof import("@modelcontextprotocol/sdk/client/streamableHttp.js")["StreamableHTTPClientTransport"];

			try {
				[{ createMCPClient }, { StreamableHTTPClientTransport }] =
					await Promise.all([
						import("@ai-sdk/mcp"),
						import("@modelcontextprotocol/sdk/client/streamableHttp.js"),
					]);
			} catch {
				return Response.json(
					{
						error:
							"MCP resource handler requires @ai-sdk/mcp and @modelcontextprotocol/sdk. Install them to enable resource serving.",
					},
					{ status: 501 },
				);
			}

			const mcp = await createMCPClient({
				transport: new StreamableHTTPClientTransport(new URL(mcpServerUrl)),
			});

			try {
				const result = await mcp.readResource({ uri });

				const content = result.contents[0];
				if (!content) {
					return Response.json(
						{ error: "Resource not found" },
						{ status: 404 },
					);
				}

				let html: string | undefined;
				if ("text" in content && typeof content.text === "string") {
					html = content.text;
				} else if ("blob" in content && typeof content.blob === "string") {
					html = atob(content.blob);
				}

				if (!html) {
					return Response.json(
						{ error: "Resource has no content" },
						{ status: 404 },
					);
				}

				return new Response(html, {
					headers: {
						"Content-Type": "text/html",
						"Cache-Control": "private, max-age=300",
					},
				});
			} finally {
				await mcp.close();
			}
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "Unknown error occurred";
			const status = error instanceof WaniWaniError ? error.status : 500;
			return Response.json({ error: message }, { status });
		}
	};
}
