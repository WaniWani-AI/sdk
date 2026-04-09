// API Handler - Composes chat and resource handlers into a unified API handler

import { createLogger } from "../../utils/logger.js";
import {
	type ApiHandler,
	type ApiHandlerOptions,
	resolveWebSearchConfig,
} from "./@types";
import { createCors, createJsonResponse } from "./@utils";
import { createChatRequestHandler } from "./handle-chat";
import { createResourceHandler } from "./handle-resource";
import { createToolHandler } from "./handle-tool";
import { createMcpConfigResolver } from "./mcp-config-resolver";

const DEFAULT_API_URL = "https://app.waniwani.ai";

export function createApiHandler(options: ApiHandlerOptions = {}): ApiHandler {
	const {
		apiKey = process.env.WANIWANI_API_KEY,
		apiUrl = DEFAULT_API_URL,
		source,
		systemPrompt,
		maxSteps = 5,
		beforeRequest,
		mcpServerUrl,
		debug = false,
		webSearch,
	} = options;

	const log = createLogger("router", debug);
	const cors = createCors();
	const json = createJsonResponse(cors);

	const resolveConfig = createMcpConfigResolver(apiUrl, apiKey);

	const handleChat = createChatRequestHandler({
		apiKey,
		apiUrl,
		source,
		systemPrompt,
		maxSteps,
		beforeRequest,
		mcpServerUrl,
		resolveConfig,
		debug,
		webSearch: resolveWebSearchConfig(webSearch),
	});

	const handleResource = createResourceHandler({
		mcpServerUrl,
		resolveConfig,
		debug,
	});

	const handleTool = createToolHandler({
		mcpServerUrl,
		resolveConfig,
		debug,
		source,
	});

	const evalEnabled = process.env.WANIWANI_EVAL === "1";

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

			if (evalEnabled && subRoute === "scenarios") {
				log("dispatching to scenarios handler (proxy to app API)");
				try {
					const res = await fetch(`${apiUrl}/api/mcp/scenarios`, {
						headers: {
							...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
						},
					});
					const data = await res.json();
					return json(data.data ?? data, 200, request);
				} catch {
					return json([], 200, request);
				}
			}

			if (subRoute === "resource") {
				log("dispatching to resource handler");
				const response = await handleResource(url);
				log("← resource handler returned", response.status);
				return cors(response, request);
			}

			if (subRoute === "config") {
				log("dispatching to config handler");
				return json({ debug, eval: evalEnabled }, 200, request);
			}

			log("← 404 no matching sub-route for", subRoute);
			return json({ error: "Not found" }, 404, request);
		} catch (error) {
			console.error("[waniwani:router] GET handler error:", error);
			const message =
				error instanceof Error ? error.message : "Unknown error occurred";
			log("← 500 from caught error");
			return json({ error: message }, 500, request);
		}
	}

	async function routePost(request: Request): Promise<Response> {
		log("→ POST", request.url);
		try {
			const url = new URL(request.url);
			const segments = url.pathname
				.replace(/\/$/, "")
				.split("/")
				.filter(Boolean);
			const subRoute = segments.at(-1);
			log("pathname:", url.pathname, "subRoute:", subRoute);

			if (evalEnabled && subRoute === "scenarios") {
				log("dispatching to save-scenario handler (proxy to app API)");
				try {
					const body = await request.json();
					const res = await fetch(`${apiUrl}/api/mcp/scenarios`, {
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
						},
						body: JSON.stringify(body),
					});
					const data = await res.json();
					if (!res.ok) {
						return json(
							{ error: data.message ?? "Failed to save scenario" },
							res.status,
							request,
						);
					}
					return json({ ok: true, scenario: data.data }, 200, request);
				} catch (e) {
					const msg =
						e instanceof Error ? e.message : "Failed to save scenario";
					return json({ error: msg }, 400, request);
				}
			}

			if (subRoute === "tool") {
				log("dispatching to tool handler");
				const response = await handleTool(request);
				log("← tool handler returned", response.status);
				return cors(response, request);
			}

			// Default: treat as chat request
			log("dispatching to chat handler");
			const chatResponse = await handleChat(request);
			return cors(chatResponse, request);
		} catch (error) {
			console.error("[waniwani:router] POST handler error:", error);
			const message =
				error instanceof Error ? error.message : "Unknown error occurred";
			log("← 500 from caught error");
			return json({ error: message }, 500, request);
		}
	}

	function handleOptions(request?: Request): Response {
		return cors(new Response(null, { status: 204 }), request);
	}

	return {
		handleChat,
		handleResource,
		handleTool,
		routeGet,
		routePost,
		handleOptions,
	};
}
