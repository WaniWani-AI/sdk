// WaniWani SDK - Chat Server Types

import type { UIMessage } from "ai";

// ============================================================================
// Before Request Hook
// ============================================================================

export interface BeforeRequestContext {
	/** The conversation messages from the client */
	messages: UIMessage[];
	/** Session identifier for conversation continuity */
	sessionId?: string;
	/** The original HTTP Request object */
	request: Request;
}

export type BeforeRequestResult = {
	/** Override messages (e.g., filtered, augmented) */
	messages?: UIMessage[];
	/** Override the system prompt for this request */
	systemPrompt?: string;
	/** Override sessionId */
	sessionId?: string;
};

// ============================================================================
// API Handler Options
// ============================================================================

export interface ApiHandlerOptions {
	/**
	 * Your WaniWani API key.
	 * Defaults to process.env.WANIWANI_API_KEY.
	 */
	apiKey?: string;

	/**
	 * The base URL of the WaniWani API.
	 * Defaults to https://app.waniwani.ai.
	 */
	baseUrl?: string;

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
// API Handler Result
// ============================================================================

export interface ApiHandler {
	/** Proxies chat messages to the WaniWani API */
	handleChat: (request: Request) => Promise<Response>;
	/** Serves MCP resource content (HTML widgets) */
	handleResource: (url: URL) => Promise<Response>;
	/** Routes GET sub-paths (e.g. /resource) */
	routeGet: (request: Request) => Promise<Response>;
}

// ============================================================================
// Internal Dependencies (shared across sub-handlers)
// ============================================================================

interface McpEnvironmentConfig {
	mcpServerUrl: string;
}

type ConfigResolver = () => Promise<McpEnvironmentConfig>;

export interface ApiHandlerDeps {
	apiKey: string | undefined;
	baseUrl: string;
	systemPrompt: string | undefined;
	maxSteps: number;
	beforeRequest: ApiHandlerOptions["beforeRequest"];
	mcpServerUrl: string | undefined;
	resolveConfig: ConfigResolver;
}

export interface ResourceHandlerDeps {
	mcpServerUrl: string | undefined;
	resolveConfig: ConfigResolver;
}
