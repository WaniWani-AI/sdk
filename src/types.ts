// Waniwani SDK - Core Types

import type { KbClient } from "./kb/types.js";
import type { TrackingClient, TrackingConfig } from "./tracking/@types.js";

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
	 * The base URL of the Waniwani API
	 *
	 * Defaults to process.env.WANIWANI_API_URL if not provided, then to
	 * https://app.waniwani.ai. Set WANIWANI_API_URL (e.g. to
	 * https://eu.app.waniwani.ai) to keep .env as the single source of truth
	 * and avoid pointing at the wrong region.
	 */
	apiUrl?: string;
	/**
	 * Tracking transport behavior.
	 */
	tracking?: TrackingConfig;
}

// ============================================================================
// Client (composed from modules)
// ============================================================================

/**
 * Waniwani SDK Client
 *
 * Extends with each module:
 * - TrackingClient: track(), flush(), shutdown()
 *
 * Pass this client to framework adapters:
 * - `toNextJsHandler(wani, { ... })` for Next.js route handlers
 */
export interface WaniWaniClient extends TrackingClient {
	/** @internal Resolved config — used by framework adapters */
	readonly _config: InternalConfig;
	/** Knowledge base client for ingestion, search, and source listing */
	readonly kb: KbClient;
}

// ============================================================================
// Internal
// ============================================================================

export interface InternalConfig {
	apiUrl: string;
	apiKey: string | undefined;
	tracking: Required<TrackingConfig>;
}
