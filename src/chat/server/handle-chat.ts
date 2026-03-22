// Handle Chat - Proxies chat requests to the WaniWani API

import { WaniWaniError } from "../../error";
import { createLogger } from "../../utils/logger.js";
import type {
	ApiHandlerDeps,
	ClientVisitorContext,
	VisitorMeta,
} from "./@types";
import { extractGeoFromHeaders } from "./geo";
import { applyModelContextToSystemPrompt } from "./model-context";

export function createChatRequestHandler(deps: ApiHandlerDeps) {
	const {
		apiKey,
		baseUrl,
		source,
		systemPrompt,
		maxSteps,
		beforeRequest,
		mcpServerUrl: mcpServerUrlOverride,
		resolveConfig,
		debug,
	} = deps;

	const log = createLogger("chat", debug);

	return async function handleChat(request: Request): Promise<Response> {
		log("→ POST", request.url);
		try {
			// 1. Parse request body
			const body = await request.json();
			let messages = body.messages ?? [];
			let sessionId: string | undefined = body.sessionId;
			let modelContext = body.modelContext;
			let effectiveSystemPrompt = systemPrompt;

			// Extract visitor context (client-side + server-side geo)
			const clientVisitorContext: ClientVisitorContext | null =
				body.visitorContext ?? null;
			const geo = extractGeoFromHeaders(request);
			const visitor: VisitorMeta = { geo, client: clientVisitorContext };

			log(
				"body parsed — messages:",
				messages.length,
				"sessionId:",
				sessionId ?? "(none)",
				"geo:",
				JSON.stringify(geo),
			);

			// 2. Run beforeRequest hook
			if (beforeRequest) {
				log("running beforeRequest hook");
				try {
					const result = await beforeRequest({
						messages,
						sessionId,
						modelContext,
						request,
						visitor,
					});

					if (result) {
						if (result.messages) {
							messages = result.messages;
						}
						if (result.systemPrompt !== undefined) {
							effectiveSystemPrompt = result.systemPrompt;
						}
						if (result.sessionId !== undefined) {
							sessionId = result.sessionId;
						}
						if (result.modelContext !== undefined) {
							modelContext = result.modelContext;
						}
					}
					log(
						"beforeRequest hook done — messages:",
						messages.length,
						"sessionId:",
						sessionId ?? "(none)",
					);
				} catch (hookError) {
					console.error("[waniwani:chat] beforeRequest hook error:", hookError);
					const status =
						hookError instanceof WaniWaniError ? hookError.status : 400;
					const message =
						hookError instanceof Error ? hookError.message : "Request rejected";
					log("← returning", status, "from hook error");
					return Response.json({ error: message }, { status });
				}
			}

			// 3. Resolve MCP server URL
			const mcpServerUrl =
				mcpServerUrlOverride ?? (await resolveConfig()).mcpServerUrl;
			log("mcpServerUrl:", mcpServerUrl);
			effectiveSystemPrompt = applyModelContextToSystemPrompt(
				effectiveSystemPrompt,
				modelContext,
			);

			// 4. Forward to WaniWani API
			const upstreamUrl = `${baseUrl}/api/mcp/chat`;
			log("forwarding to", upstreamUrl);
			const clientUserAgent = request.headers.get("user-agent");

			const response = await fetch(upstreamUrl, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
					...(clientUserAgent
						? { "X-Client-User-Agent": clientUserAgent }
						: {}),
				},
				body: JSON.stringify({
					messages,
					mcpServerUrl,
					sessionId,
					source,
					systemPrompt: effectiveSystemPrompt,
					maxSteps,
					visitor,
				}),
				signal: request.signal,
			});

			log("upstream response status:", response.status);

			if (!response.ok) {
				const errorBody = await response.text().catch(() => "");
				log("← returning", response.status, "upstream error:", errorBody);
				return new Response(errorBody, {
					status: response.status,
					headers: {
						"Content-Type":
							response.headers.get("Content-Type") ?? "application/json",
					},
				});
			}

			// 5. Stream the response back
			const headers = new Headers({
				"Content-Type":
					response.headers.get("Content-Type") ?? "text/event-stream",
			});
			const upstreamSessionId = response.headers.get("x-session-id");
			if (upstreamSessionId) {
				headers.set("x-session-id", upstreamSessionId);
			}

			log(
				"← streaming response",
				response.status,
				"body null?",
				response.body === null,
			);
			return new Response(response.body, {
				status: response.status,
				headers,
			});
		} catch (error) {
			console.error("[waniwani:chat] handler error:", error);
			const message =
				error instanceof Error ? error.message : "Unknown error occurred";
			const status = error instanceof WaniWaniError ? error.status : 500;
			log("← returning", status, "from caught error");
			return Response.json({ error: message }, { status });
		}
	};
}
