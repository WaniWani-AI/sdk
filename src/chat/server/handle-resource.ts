// Handle Resource - Serves MCP resource content (HTML widgets)

import { WaniWaniError } from "../../error";
import type { ResourceHandlerDeps } from "./@types";

export function createResourceHandler(deps: ResourceHandlerDeps) {
	const { mcpServerUrl: mcpServerUrlOverride, resolveConfig, debug } = deps;

	const log = debug
		? (...args: unknown[]) => console.log("[waniwani:resource]", ...args)
		: () => {};

	return async function handleResource(url: URL): Promise<Response> {
		log("→ GET", url.toString());
		try {
			const uri = url.searchParams.get("uri");
			log("uri:", uri ?? "(missing)");

			if (!uri) {
				log("← 400 missing uri");
				return Response.json(
					{ error: "Missing uri query parameter" },
					{ status: 400 },
				);
			}

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
					"[waniwani:resource] MCP deps import failed:",
					importError,
				);
				return Response.json(
					{
						error:
							"MCP resource handler requires @ai-sdk/mcp and @modelcontextprotocol/sdk. Install them to enable resource serving.",
					},
					{ status: 501 },
				);
			}

			log("creating MCP client for", mcpServerUrl);
			const mcp = await createMCPClient({
				transport: new StreamableHTTPClientTransport(new URL(mcpServerUrl)),
			});

			try {
				log("reading resource:", uri);
				const result = await mcp.readResource({ uri });
				log("resource contents count:", result.contents.length);

				const content = result.contents[0];
				if (!content) {
					log("← 404 resource not found");
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
					log("← 404 resource has no content, keys:", Object.keys(content));
					return Response.json(
						{ error: "Resource has no content" },
						{ status: 404 },
					);
				}

				log("← 200 HTML length:", html.length);
				return new Response(html, {
					headers: {
						"Content-Type": "text/html",
						"Cache-Control": "private, max-age=300",
					},
				});
			} finally {
				await mcp.close();
				log("MCP client closed");
			}
		} catch (error) {
			console.error("[waniwani:resource] handler error:", error);
			const message =
				error instanceof Error ? error.message : "Unknown error occurred";
			const status = error instanceof WaniWaniError ? error.status : 500;
			log("← returning", status, "from caught error");
			return Response.json({ error: message }, { status });
		}
	};
}
