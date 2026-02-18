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

	function routeGet(request: Request): Promise<Response> {
		const url = new URL(request.url);
		const segments = url.pathname.replace(/\/$/, "").split("/").filter(Boolean);
		const subRoute = segments.at(-1);

		if (subRoute === "resource") {
			return handleResource(url);
		}

		return Promise.resolve(
			Response.json({ error: "Not found" }, { status: 404 }),
		);
	}

	return { handleChat, handleResource, routeGet };
}
