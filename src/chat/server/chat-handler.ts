// Chat Handler - Proxies chat requests to the WaniWani API

import { WaniWaniError } from "../../error";
import type { ChatHandlerOptions } from "./@types";
import { createMcpConfigResolver } from "./mcp-config-resolver";

/**
 * Create a chat request handler that proxies requests to the WaniWani API.
 * The WaniWani API handles MCP tool discovery, LLM calls, and event logging.
 *
 * Returns a `(request: Request) => Promise<Response>` function compatible
 * with Next.js Route Handlers, Hono, and any framework using the Fetch API.
 *
 * @example
 * ```typescript
 * import { createChatHandler } from "@waniwani/sdk/chat/server";
 *
 * export const POST = createChatHandler({
 *   systemPrompt: "You are a helpful assistant.",
 * });
 * ```
 */
export function createChatHandler(
	options: ChatHandlerOptions = {},
): (request: Request) => Promise<Response> {
	const {
		apiKey = process.env.WANIWANI_API_KEY,
		baseUrl = "https://app.waniwani.ai",
		systemPrompt,
		maxSteps = 5,
		beforeRequest,
		mcpServerUrl: mcpServerUrlOverride,
	} = options;

	const resolveConfig = createMcpConfigResolver(baseUrl, apiKey);

	return async function handler(request: Request): Promise<Response> {
		try {
			// 1. Parse request body
			const body = await request.json();
			let messages = body.messages ?? [];
			let sessionId: string | undefined = body.sessionId;
			let effectiveSystemPrompt = systemPrompt;

			// 2. Run beforeRequest hook
			if (beforeRequest) {
				try {
					const result = await beforeRequest({
						messages,
						sessionId,
						request,
					});

					if (result) {
						if (result.messages) messages = result.messages;
						if (result.systemPrompt !== undefined)
							effectiveSystemPrompt = result.systemPrompt;
						if (result.sessionId !== undefined) sessionId = result.sessionId;
					}
				} catch (hookError) {
					const status =
						hookError instanceof WaniWaniError ? hookError.status : 400;
					const message =
						hookError instanceof Error ? hookError.message : "Request rejected";
					return Response.json({ error: message }, { status });
				}
			}

			// 3. Resolve MCP server URL
			const mcpServerUrl =
				mcpServerUrlOverride ?? (await resolveConfig()).mcpServerUrl;

			// 4. Forward to WaniWani API
			const response = await fetch(`${baseUrl}/api/mcp/chat`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
				},
				body: JSON.stringify({
					messages,
					mcpServerUrl,
					sessionId,
					systemPrompt: effectiveSystemPrompt,
					maxSteps,
				}),
				signal: request.signal,
			});

			if (!response.ok) {
				const errorBody = await response.text().catch(() => "");
				return new Response(errorBody, {
					status: response.status,
					headers: {
						"Content-Type":
							response.headers.get("Content-Type") ?? "application/json",
					},
				});
			}

			// 5. Stream the response back
			return new Response(response.body, {
				status: response.status,
				headers: {
					"Content-Type":
						response.headers.get("Content-Type") ?? "text/event-stream",
				},
			});
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "Unknown error occurred";
			const status = error instanceof WaniWaniError ? error.status : 500;

			return Response.json({ error: message }, { status });
		}
	};
}
