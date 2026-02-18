// WaniWani SDK - Core Types

import type { TrackingClient } from "./tracking/@types.js";

// ============================================================================
// Configuration
// ============================================================================

export interface WaniWaniConfig {
	/**
	 * Your MCP environment API key
	 *
	 * Defaults to process.env.WANIWANI_API_KEY if not provided
	 *
	 * To create one, visit:
	 * https://app.waniwani.com/mcp/environments
	 */
	apiKey?: string;
	/**
	 * The base URL of the WaniWani API
	 *
	 * Defaults to https://app.waniwani.ai
	 */
	baseUrl?: string;
}

// ============================================================================
// Client (composed from modules)
// ============================================================================

/**
 * WaniWani SDK Client
 *
 * Extends with each module:
 * - TrackingClient: track(), getOrCreateSession()
 *
 * Pass this client to framework adapters:
 * - `toNextJsHandler(wani, { ... })` for Next.js route handlers
 */
export interface WaniWaniClient extends TrackingClient {
	/** @internal Resolved config — used by framework adapters */
	readonly _config: InternalConfig;
}

// ============================================================================
// Internal
// ============================================================================

export interface InternalConfig {
	baseUrl: string;
	apiKey: string | undefined;
}
