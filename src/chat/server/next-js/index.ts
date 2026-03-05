// WaniWani SDK - Next.js Adapter
//
// IMPORTANT: All responses returned to Next.js must be created via
// NextResponse (from next/server) — not the global Response.json().
// In Next.js 16 / Turbopack the native Response.json() static method
// produces objects that fail Next.js's internal `instanceof Response`
// check, causing "No response is returned from route handler" errors.

import type { WaniWaniClient } from "../../../types.js";
import { createApiHandler } from "../api-handler.js";
import type { NextJsHandlerOptions, NextJsHandlerResult } from "./@types.js";

export type { NextJsHandlerOptions, NextJsHandlerResult } from "./@types.js";

let _NextResponse: typeof import("next/server").NextResponse;

try {
	_NextResponse = (await import("next/server")).NextResponse;
} catch {
	throw new Error(
		'@waniwani/sdk/next-js requires "next" as a dependency. Install it with: npm install next',
	);
}

/**
 * Re-create a Response using NextResponse so it passes Next.js's
 * internal `instanceof` check (works around Turbopack polyfill mismatch).
 */
function toNextResponse(res: Response): Response {
	return new _NextResponse(res.body, {
		status: res.status,
		statusText: res.statusText,
		headers: res.headers,
	});
}

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
 * export const { GET, POST, dynamic } = toNextJsHandler(wani, {
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

	const debugEnabled = options?.debug ?? process.env.WANIWANI_DEBUG === "1";

	const handler = createApiHandler({
		...options?.chat,
		apiKey,
		baseUrl,
		debug: debugEnabled,
	});

	return {
		POST: async (request: Request) =>
			toNextResponse(await handler.handleChat(request)),
		GET: async (request: Request) =>
			toNextResponse(await handler.routeGet(request)),
		dynamic: "force-dynamic" as const,
	};
}
