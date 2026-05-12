// WaniWani SDK - Express Adapter Types

import type { ChatOptions } from "../server/@types.js";

export type { ChatOptions };

// ============================================================================
// Express Handler Options
// ============================================================================

export interface ExpressJsHandlerOptions {
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
// Express Handler Result
// ============================================================================

/**
 * Express middleware signatures. Typed against `unknown` to avoid forcing
 * `@types/express` on consumers that don't use Express. Cast at the call site
 * if your IDE doesn't infer correctly.
 */
export type ExpressMiddleware = (
	req: ExpressLikeRequest,
	res: ExpressLikeResponse,
	next: (err?: unknown) => void,
) => void;

/** Subset of Express's Request that the adapter actually reads. */
export interface ExpressLikeRequest {
	method: string;
	url: string;
	originalUrl?: string;
	headers: Record<string, string | string[] | undefined>;
	protocol?: string;
	get?: (name: string) => string | undefined;
	on: (event: string, listener: (...args: unknown[]) => void) => void;
}

/** Subset of Express's Response that the adapter actually writes to. */
export interface ExpressLikeResponse {
	statusCode: number;
	setHeader: (name: string, value: string | number | readonly string[]) => void;
	status: (code: number) => ExpressLikeResponse;
	end: (chunk?: unknown, encoding?: BufferEncoding) => void;
	write: (chunk: unknown, encoding?: BufferEncoding) => boolean;
	on: (event: string, listener: (...args: unknown[]) => void) => void;
}

export interface ExpressJsHandlerResult {
	/** GET handler: routes sub-paths (e.g. /resource for MCP widget content) */
	get: ExpressMiddleware;
	/** POST handler: proxies chat messages to the WaniWani API */
	post: ExpressMiddleware;
	/** PATCH handler: routes updates (e.g. /scenarios/:id) */
	patch: ExpressMiddleware;
	/** OPTIONS handler: CORS preflight (no `next` argument needed) */
	options: (req: ExpressLikeRequest, res: ExpressLikeResponse) => void;
}
