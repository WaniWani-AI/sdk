// Waniwani SDK - Next.js Adapter

import type { WaniWaniClient } from "../../../types.js";
import { createApiHandler } from "../server/api-handler.js";
import type { NextJsHandlerOptions, NextJsHandlerResult } from "./@types.js";

export type { NextJsHandlerOptions, NextJsHandlerResult } from "./@types.js";

let deprecationWarned = false;

/**
 * Create Next.js route handlers from a Waniwani client.
 *
 * Returns `{ GET, POST }` for use with catch-all routes.
 * Mount at `app/api/waniwani/[[...path]]/route.ts`:
 *
 * - `POST /api/waniwani`              → chat (proxied to Waniwani API)
 * - `GET  /api/waniwani/resource?uri=…` → MCP resource content
 *
 * @deprecated The chat-server catch-all adapters are being phased out. The chat widget
 *   will talk directly to `app.waniwani.ai` in a future release, removing the need for a
 *   self-hosted BFF. This export is preserved for back-compat with existing customer MCPs
 *   but is no longer documented; it will move to `@waniwani/sdk/legacy/next-js` in a future
 *   minor release.
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
	options: NextJsHandlerOptions,
): NextJsHandlerResult {
	if (!deprecationWarned && process.env.NODE_ENV !== "test") {
		console.warn(
			"[waniwani-sdk] toNextJsHandler is deprecated; switch to toExpressJsHandler from @waniwani/sdk/express-js. It will be removed in a follow-up release.",
		);
		deprecationWarned = true;
	}

	const { apiKey, apiUrl } = client._config;

	const debugEnabled = options?.debug ?? process.env.WANIWANI_DEBUG === "1";

	const handler = createApiHandler({
		...options?.chat,
		apiKey,
		apiUrl,
		source: options?.source,
		debug: debugEnabled,
	});

	return {
		POST: handler.routePost,
		GET: handler.routeGet,
		PATCH: handler.routePatch,
		OPTIONS: () => handler.handleOptions(),
	};
}
