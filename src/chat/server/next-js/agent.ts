// WaniWani SDK - Chat Agent (one-liner route setup for MCP apps)

import { waniwani } from "../../../waniwani.js";
import type {
	BeforeRequestContext,
	BeforeRequestResult,
	WebSearchConfig,
} from "../@types.js";
import { createApiHandler } from "../api-handler.js";
import type { NextJsHandlerResult } from "./@types.js";

export interface ChatAgentOptions {
	/**
	 * System prompt for the chat agent.
	 */
	systemPrompt?: string;

	/**
	 * MCP server URL. Defaults to auto-detection from WaniWani config.
	 */
	mcpServerUrl?: string;

	/**
	 * Embed token authentication. When set, POST requests must include
	 * a valid `Authorization: Bearer wwp_...` token from the allowlist.
	 *
	 * @example
	 * ```typescript
	 * embedAuth: { tokens: process.env.WANIWANI_EMBED_TOKENS }
	 * ```
	 */
	embedAuth?: {
		/** Comma-separated allowed tokens. Defaults to `WANIWANI_EMBED_TOKENS` env var. */
		tokens?: string;
	};

	/**
	 * Identifies this agent in analytics.
	 * Defaults to `"embed"`.
	 */
	source?: string;

	/**
	 * Maximum number of tool call steps per request. Defaults to 5.
	 */
	maxSteps?: number;

	/**
	 * Hook called before each chat request.
	 */
	beforeRequest?: (
		context: BeforeRequestContext,
	) =>
		| Promise<BeforeRequestResult | undefined>
		| BeforeRequestResult
		| undefined;

	/**
	 * Enable web search tool alongside MCP tools.
	 */
	webSearch?: boolean | WebSearchConfig;

	/**
	 * Enable verbose debug logging. Defaults to `WANIWANI_DEBUG` env var.
	 */
	debug?: boolean;

	/**
	 * WaniWani API key. Defaults to `WANIWANI_API_KEY` env var.
	 */
	apiKey?: string;

	/**
	 * WaniWani API URL. Defaults to `https://app.waniwani.ai`.
	 */
	apiUrl?: string;
}

/**
 * Create Next.js route handlers for an embeddable chat agent.
 *
 * Combines `waniwani()` client creation + `toNextJsHandler()` into a single
 * call. Mount at `app/api/chat/[[...path]]/route.ts`:
 *
 * @example
 * ```typescript
 * import { createChatAgent } from "@waniwani/sdk/next-js";
 *
 * export const maxDuration = 60;
 *
 * export const { GET, POST, OPTIONS } = createChatAgent({
 *   systemPrompt: "You are a helpful pet care assistant.",
 *   mcpServerUrl: process.env.MCP_SERVER_URL,
 *   embedAuth: {
 *     tokens: process.env.WANIWANI_EMBED_TOKENS,
 *   },
 * });
 * ```
 */
export function createChatAgent(
	options: ChatAgentOptions = {},
): NextJsHandlerResult {
	const {
		systemPrompt,
		mcpServerUrl,
		embedAuth,
		source = "embed",
		maxSteps,
		beforeRequest,
		webSearch,
		apiKey,
		apiUrl,
	} = options;

	const client = waniwani({
		apiKey: apiKey ?? process.env.WANIWANI_API_KEY,
		apiUrl: apiUrl ?? undefined,
	});

	const { apiKey: resolvedApiKey, apiUrl: resolvedApiUrl } = client._config;
	const debugEnabled = options.debug ?? process.env.WANIWANI_DEBUG === "1";

	const handler = createApiHandler({
		apiKey: resolvedApiKey,
		apiUrl: resolvedApiUrl,
		source,
		systemPrompt,
		maxSteps,
		beforeRequest,
		mcpServerUrl,
		webSearch,
		embedAuth,
		debug: debugEnabled,
	});

	return {
		POST: handler.routePost,
		GET: handler.routeGet,
		PATCH: handler.routePatch,
		OPTIONS: () => handler.handleOptions(),
	};
}
