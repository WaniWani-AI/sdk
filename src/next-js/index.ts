// WaniWani SDK - Next.js Adapter

import { createApiHandler } from "../chat/server/api-handler.js";
import type { WaniWaniClient } from "../types.js";
import type { NextJsHandlerOptions, NextJsHandlerResult } from "./@types.js";

export type { NextJsHandlerOptions, NextJsHandlerResult } from "./@types.js";

/**
 * Create Next.js route handlers from a WaniWani client.
 *
 * Returns `{ GET, POST }` for use with catch-all routes.
 * Mount at `app/api/waniwani/[[...path]]/route.ts`:
 *
 * - `POST /api/waniwani`              → chat (proxied to WaniWani API)
 * - `GET  /api/waniwani/resource?uri=…` → MCP resource content
 *
 * @example
 * ```typescript
 * // app/api/waniwani/[[...path]]/route.ts
 * import { waniwani } from "@waniwani/sdk";
 * import { toNextJsHandler } from "@waniwani/sdk/next-js";
 *
 * const wani = waniwani();
 *
 * export const { GET, POST } = toNextJsHandler(wani, {
 *   chat: {
 *     systemPrompt: "You are a helpful assistant.",
 *     mcpServerUrl: process.env.MCP_SERVER_URL!,
 *   },
 * });
 * ```
 */
export function toNextJsHandler(
	client: WaniWaniClient,
	options?: NextJsHandlerOptions,
): NextJsHandlerResult {
	const { apiKey, baseUrl } = client._config;

	const handler = createApiHandler({
		...options?.chat,
		apiKey,
		baseUrl,
	});

	return {
		POST: handler.handleChat,
		GET: handler.routeGet,
	};
}
