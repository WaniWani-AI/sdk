// Chat Handler - Creates a request handler for AI chat with MCP tools

import { createMCPClient } from "@ai-sdk/mcp";
import {
	convertToModelMessages,
	createUIMessageStream,
	createUIMessageStreamResponse,
	stepCountIs,
	streamText,
	type ToolSet,
	type UIMessage,
} from "ai";
import { WaniWaniError } from "../../error";
import type { ChatHandlerOptions } from "./@types";
import { createMcpConfigResolver } from "./mcp-config-resolver";

/**
 * Create a chat request handler that connects to a WaniWani MCP server,
 * discovers tools, and streams AI responses.
 *
 * Returns a `(request: Request) => Promise<Response>` function compatible
 * with Next.js Route Handlers, Hono, and any framework using the Fetch API.
 *
 * Note: Streamable HTTP transport is only supported for the MCP server.
 *
 * @example
 * ```typescript
 * import { createChatHandler } from "@waniwani/sdk/chat/server";
 * import { openai } from "@ai-sdk/openai";
 *
 * export const POST = createChatHandler({
 *   systemPrompt: "You are a helpful assistant.",
 *   mcpServerUrl: "http://localhost:3000/mcp",
 * });
 * ```
 */
export function createChatHandler(
	options: ChatHandlerOptions,
): (request: Request) => Promise<Response> {
	const {
		model = "openai/gpt-5.2-chat",
		apiKey = process.env.WANIWANI_API_KEY,
		baseUrl = "https://app.waniwani.ai",
		systemPrompt,
		maxSteps = 5,
		beforeRequest,
		onFinish,
		mcpServerUrl: mcpServerUrlOverride,
	} = options;

	console.log("createChatHandler", options);

	const resolveConfig = createMcpConfigResolver(baseUrl, apiKey);

	return async function handler(request: Request): Promise<Response> {
		let mcp: Awaited<ReturnType<typeof createMCPClient>> | null = null;

		try {
			// 1. Parse request body
			const body = await request.json();
			let messages: UIMessage[] = body.messages ?? [];
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

			// 4. Convert messages for the model
			const modelMessages = await convertToModelMessages(messages);

			// 5. Create MCP client and discover tools
			mcp = await createMCPClient({
				transport: {
					type: "http",
					url: mcpServerUrl,
					headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
				},
			});
			const tools = await mcp.tools();

			// 6. Create and return the streaming response
			const stream = createUIMessageStream({
				execute: async ({ writer }) => {
					const result = streamText({
						model,
						system: effectiveSystemPrompt,
						messages: modelMessages,
						tools: tools as ToolSet,
						stopWhen: stepCountIs(maxSteps),
					});

					writer.merge(result.toUIMessageStream());
				},
				onFinish: async (event) => {
					// Always close the MCP client
					await mcp?.close().catch(() => {});
					mcp = null;

					// Call user's onFinish hook
					if (onFinish) {
						try {
							await onFinish({
								messages: event.messages,
								isContinuation: event.isContinuation,
								isAborted: event.isAborted,
								responseMessage: event.responseMessage,
							});
						} catch (err) {
							console.error("[WaniWani] onFinish error:", err);
						}
					}
				},
			});

			return createUIMessageStreamResponse({ stream });
		} catch (error) {
			console.error("[Waniwani] createChatHandler:", error);
			// Ensure MCP client is closed on error
			await mcp?.close().catch(() => {});

			const message =
				error instanceof Error ? error.message : "Unknown error occurred";
			const status = error instanceof WaniWaniError ? error.status : 500;

			return Response.json({ error: message }, { status });
		}
	};
}
