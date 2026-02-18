// WaniWani SDK - Next.js Adapter Types

import type { BeforeRequestContext, BeforeRequestResult } from "../@types.js";

// ============================================================================
// Chat Options (namespaced under `chat`)
// ============================================================================

export interface ChatOptions {
	/**
	 * System prompt for the assistant.
	 * Can be overridden per-request via `beforeRequest`.
	 */
	systemPrompt?: string;

	/**
	 * Maximum number of tool call steps. Defaults to 5.
	 */
	maxSteps?: number;

	/**
	 * Hook called before each request is forwarded to the WaniWani API.
	 * - Return void to use defaults.
	 * - Return an object to override messages, systemPrompt, or sessionId.
	 * - Throw to reject the request (the error message is returned as JSON).
	 */
	beforeRequest?: (
		context: BeforeRequestContext,
	) =>
		| Promise<BeforeRequestResult | undefined>
		| BeforeRequestResult
		| undefined;

	/**
	 * Override the MCP server URL directly, bypassing config resolution.
	 * Useful for development/testing when pointing to a local MCP server.
	 */
	mcpServerUrl?: string;
}

// ============================================================================
// Next.js Handler Options
// ============================================================================

export interface NextJsHandlerOptions {
	/** Chat handler configuration */
	chat?: ChatOptions;
}

// ============================================================================
// Next.js Handler Result
// ============================================================================

export interface NextJsHandlerResult {
	/** GET handler: routes sub-paths (e.g. /resource for MCP widget content) */
	GET: (request: Request) => Promise<Response>;
	/** POST handler: proxies chat messages to the WaniWani API */
	POST: (request: Request) => Promise<Response>;
}
