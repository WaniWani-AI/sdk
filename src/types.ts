// WaniWani SDK - Core Types

import type { ChatHandlerOptions } from "./chat/server/@types.js";
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
 * - Future: ToolsClient, etc.
 */
export interface WaniWaniClient extends TrackingClient {
	/**
	 * Create a chat request handler that proxies to the WaniWani API.
	 * Inherits apiKey and baseUrl from the client config.
	 */
	createChatHandler: (
		options?: Omit<ChatHandlerOptions, "apiKey" | "baseUrl">,
	) => (request: Request) => Promise<Response>;
}

// ============================================================================
// Internal
// ============================================================================

export interface InternalConfig {
	baseUrl: string;
	apiKey: string | undefined;
}
