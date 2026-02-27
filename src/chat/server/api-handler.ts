// API Handler - Composes chat and resource handlers into a unified API handler

import type { ApiHandler, ApiHandlerOptions } from "./@types";
import { createChatRequestHandler } from "./handle-chat";
import { createResourceHandler } from "./handle-resource";
import { createMcpConfigResolver } from "./mcp-config-resolver";

/**
 * Create a framework-agnostic API handler for chat and MCP resources.
 *
 * Returns an object with handler methods that can be wired into
 * any framework (Next.js, Hono, Express, etc.):
 *
 * - `handleChat(request)` → proxies chat messages to WaniWani API
 * - `handleResource(url)` → serves MCP resource content (HTML widgets)
 * - `routeGet(request)` → routes GET sub-paths (e.g. /resource)
 *
 * @example
 * ```typescript
 * import { waniwani } from "@waniwani/sdk";
 * import { toNextJsHandler } from "@waniwani/sdk/next-js";
 *
 * const wani = waniwani();
 *
 * export const { GET, POST } = toNextJsHandler(wani, {
 *   chat: { systemPrompt: "You are a helpful assistant." },
 * });
 * ```
 */
export function createApiHandler(options: ApiHandlerOptions = {}): ApiHandler {
	const {
		apiKey = process.env.WANIWANI_API_KEY,
		baseUrl = "https://app.waniwani.ai",
		systemPrompt,
		maxSteps = 5,
		beforeRequest,
		mcpServerUrl,
	} = options;

	const resolveConfig = createMcpConfigResolver(baseUrl, apiKey);

	const handleChat = createChatRequestHandler({
		apiKey,
		baseUrl,
		systemPrompt,
		maxSteps,
		beforeRequest,
		mcpServerUrl,
		resolveConfig,
	});

	const handleResource = createResourceHandler({
		mcpServerUrl,
		resolveConfig,
	});

	async function routeGet(request: Request): Promise<Response> {
		try {
			const url = new URL(request.url);
			const segments = url.pathname
				.replace(/\/$/, "")
				.split("/")
				.filter(Boolean);
			const subRoute = segments.at(-1);

			if (subRoute === "resource") {
				return await handleResource(url);
			}

			return Response.json({ error: "Not found" }, { status: 404 });
		} catch (error) {
			console.error("[waniwani] GET handler error:", error);
			const message =
				error instanceof Error ? error.message : "Unknown error occurred";
			return Response.json({ error: message }, { status: 500 });
		}
	}

	return { handleChat, handleResource, routeGet };
}
