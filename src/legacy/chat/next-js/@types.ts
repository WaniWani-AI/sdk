// WaniWani SDK - Next.js Adapter Types

import type { ChatOptions } from "../server/@types.js";

export type { ChatOptions };

// ============================================================================
// Next.js Handler Options
// ============================================================================

export interface NextJsHandlerOptions {
	/** Chat handler configuration */
	chat?: ChatOptions;

	/**
	 * Identifies this chatbar instance in analytics.
	 * Use a descriptive name like "hamilton-support" or "pricing-page".
	 * Shows up as `source` on tracked events.
	 */
	source: string;

	/**
	 * Enable verbose debug logging for all handler steps.
	 * Logs request details, response codes, resolved URLs, and caught errors.
	 */
	debug?: boolean;
}

// ============================================================================
// Next.js Handler Result
// ============================================================================

export interface NextJsHandlerResult {
	/** GET handler: routes sub-paths (e.g. /resource for MCP widget content) */
	GET: (request: Request) => Promise<Response>;
	/** POST handler: proxies chat messages to the WaniWani API */
	POST: (request: Request) => Promise<Response>;
	/** PATCH handler: routes updates (e.g. /scenarios/:id) */
	PATCH: (request: Request) => Promise<Response>;
	/** OPTIONS handler: CORS preflight */
	OPTIONS: (request: Request) => Response;
}
