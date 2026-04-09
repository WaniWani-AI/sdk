// WaniWani SDK - Chat Server Types

import type { UIMessage } from "ai";
import type { ModelContextUpdate } from "../../shared/model-context";
import type { GeoLocation } from "./geo";

// ============================================================================
// Visitor Context
// ============================================================================

/** Client-side visitor context sent in the request body */
export interface ClientVisitorContext {
	timezone: string;
	language: string;
	languages: string[];
	deviceType: "mobile" | "tablet" | "desktop";
	referrer: string;
	visitorId: string;
}

/** Combined visitor context: server geo + client context */
export interface VisitorMeta {
	geo: GeoLocation;
	client: ClientVisitorContext | null;
}

// ============================================================================
// Before Request Hook
// ============================================================================

export interface BeforeRequestContext {
	/** The conversation messages from the client */
	messages: UIMessage[];
	/** Session identifier for conversation continuity */
	sessionId?: string;
	/** Hidden widget-provided model context for the next assistant turn */
	modelContext?: ModelContextUpdate;
	/** The original HTTP Request object */
	request: Request;
	/** Server-extracted geo location + client-provided visitor context */
	visitor: VisitorMeta;
}

export type BeforeRequestResult = {
	/** Override messages (e.g., filtered, augmented) */
	messages?: UIMessage[];
	/** Override the system prompt for this request */
	systemPrompt?: string;
	/** Override sessionId */
	sessionId?: string;
	/** Override hidden widget-provided model context */
	modelContext?: ModelContextUpdate;
};

// ============================================================================
// Web Search
// ============================================================================

export interface WebSearchConfig {
	/** Restrict web search results to these domains */
	includeDomains?: string[];
	/** Exclude these domains from web search results */
	excludeDomains?: string[];
}

// ============================================================================
// API Handler Options
// ============================================================================

export interface ApiHandlerOptions {
	/**
	 * Identifies this chatbar instance in analytics.
	 * Forwarded as `waniwani/source` in MCP request metadata.
	 */
	source?: string;

	/**
	 * Your WaniWani API key.
	 * Defaults to process.env.WANIWANI_API_KEY.
	 */
	apiKey?: string;

	/**
	 * The base URL of the WaniWani API.
	 * Defaults to https://app.waniwani.ai.
	 */
	apiUrl?: string;

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

	/**
	 * Enable verbose debug logging for all handler steps.
	 * Logs request details, response codes, resolved URLs, and caught errors.
	 */
	debug?: boolean;

	/**
	 * Enable web search as an additional tool alongside MCP tools.
	 * Pass `true` to enable with defaults, or a config object to restrict domains.
	 */
	webSearch?: boolean | WebSearchConfig;
}

// ============================================================================
// API Handler Result
// ============================================================================

export interface ApiHandler {
	/** Proxies chat messages to the WaniWani API */
	handleChat: (request: Request) => Promise<Response>;
	/** Serves MCP resource content (HTML widgets) */
	handleResource: (url: URL) => Promise<Response>;
	/** Calls an MCP server tool and returns JSON */
	handleTool: (request: Request) => Promise<Response>;
	/** Routes GET sub-paths (e.g. /resource) */
	routeGet: (request: Request) => Promise<Response>;
	/** Routes POST sub-paths (e.g. /tool), defaults to chat */
	routePost: (request: Request) => Promise<Response>;
	/** Handles CORS preflight requests */
	handleOptions: (request?: Request) => Response;
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
	apiUrl: string;
	source: string | undefined;
	systemPrompt: string | undefined;
	maxSteps: number;
	beforeRequest: ApiHandlerOptions["beforeRequest"];
	mcpServerUrl: string | undefined;
	resolveConfig: ConfigResolver;
	debug: boolean;
	webSearch?: WebSearchConfig;
}

/** Normalize `true` to `{}` so the upstream API always receives an object or undefined */
export function resolveWebSearchConfig(
	value: boolean | WebSearchConfig | undefined,
): WebSearchConfig | undefined {
	if (value === true) {
		return {};
	}
	if (value === false || value === undefined) {
		return undefined;
	}
	return value;
}

export interface ResourceHandlerDeps {
	mcpServerUrl: string | undefined;
	resolveConfig: ConfigResolver;
	debug: boolean;
	source?: string;
}
