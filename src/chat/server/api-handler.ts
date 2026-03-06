// API Handler - Composes chat and resource handlers into a unified API handler

import { createLogger } from "../../utils/logger.js";
import type { ApiHandler, ApiHandlerOptions } from "./@types";
import { createChatRequestHandler } from "./handle-chat";
import { createResourceHandler } from "./handle-resource";
import { createMcpConfigResolver } from "./mcp-config-resolver";

/**
 * Create a JSON response with the given data and status code.
 * @param data - The data to be serialized to JSON.
 * @param status - The HTTP status code to be returned.
 * @returns A Response object with the JSON data and the given status code.
 */
function jsonResponse(data: object, status: number): Response {
	return new Response(JSON.stringify(data), {
		headers: { "Content-Type": "application/json" },
		status,
	});
}

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
 * export const { GET, POST, dynamic } = toNextJsHandler(wani, {
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
		debug = false,
	} = options;

	const log = createLogger("router", debug);

	const resolveConfig = createMcpConfigResolver(baseUrl, apiKey);

	const handleChat = createChatRequestHandler({
		apiKey,
		baseUrl,
		systemPrompt,
		maxSteps,
		beforeRequest,
		mcpServerUrl,
		resolveConfig,
		debug,
	});

	const handleResource = createResourceHandler({
		mcpServerUrl,
		resolveConfig,
		debug,
	});

	async function handleConfig(): Promise<Response> {
		return jsonResponse({ debug }, 200);
	}

	async function routeGet(request: Request): Promise<Response> {
		log("→ GET", request.url);
		try {
			const url = new URL(request.url);
			const segments = url.pathname
				.replace(/\/$/, "")
				.split("/")
				.filter(Boolean);
			const subRoute = segments.at(-1);
			log("pathname:", url.pathname, "subRoute:", subRoute);

			if (subRoute === "resource") {
				log("dispatching to resource handler");
				const response = await handleResource(url);
				log("← resource handler returned", response.status);
				return response;
			}

			if (subRoute === "config") {
				log("dispatching to config handler");
				const response = await handleConfig();
				log("← config handler returned", response.status);
				return response;
			}

			log("← 404 no matching sub-route for", subRoute);
			return jsonResponse({ error: "Not found" }, 404);
		} catch (error) {
			console.error("[waniwani:router] GET handler error:", error);
			const message =
				error instanceof Error ? error.message : "Unknown error occurred";
			log("← 500 from caught error");
			return jsonResponse({ error: message }, 500);
		}
	}

	return { handleChat, handleResource, routeGet };
}
