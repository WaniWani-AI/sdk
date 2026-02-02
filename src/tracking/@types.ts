// Tracking Module Types

// ============================================
// Provider Types
// ============================================

export type MCPProvider = "openai" | "anthropic" | "unknown";

/** OpenAI-specific MCP metadata structure */
export interface OpenAIMeta {
	"openai/subject"?: string;
	"openai/session"?: string;
	"openai/userAgent"?: string;
	"openai/locale"?: string;
	"openai/userLocation"?: {
		city?: string;
		region?: string;
		country?: string;
		timezone?: string;
		latitude?: string;
		longitude?: string;
	};
	timezone_offset_minutes?: number;
}

/** Anthropic-specific MCP metadata structure (TBD) */
export type AnthropicMeta = Record<string, unknown>;

/** Location information (provider-agnostic) */
export interface LocationInfo {
	city?: string;
	region?: string;
	country?: string;
	timezone?: string;
}

/** Normalized metadata extracted from any MCP provider */
export interface NormalizedMeta {
	provider: MCPProvider;
	sessionId?: string;
	externalUserId?: string;
	userAgent?: string;
	locale?: string;
	location?: LocationInfo;
}

// ============================================
// Event Types
// ============================================

export type EventType =
	| "session.started"
	| "tool.called"
	| "quote.requested"
	| "quote.succeeded"
	| "quote.failed"
	| "link.clicked"
	| "purchase.completed";

export type ToolType =
	| "pricing"
	| "product_info"
	| "availability"
	| "support"
	| "other";

interface BaseEvent {
	/**
	 * MCP request metadata. The SDK auto-extracts provider fields
	 * (sessionId, userId, location, etc.). Can also include custom fields.
	 *
	 * Location varies by MCP library:
	 * - `@vercel/mcp-handler`: `extra._meta`
	 * - `@modelcontextprotocol/sdk`: `request.params._meta`
	 *
	 * @example
	 * ```typescript
	 * wani.track({
	 *   eventType: 'tool.called',
	 *   toolName: 'search',
	 *   meta: extra._meta,
	 * });
	 * ```
	 */
	meta?: Record<string, unknown>;
}

export type TrackEvent =
	| ({ eventType: "session.started" } & BaseEvent)
	| ({
			eventType: "tool.called";
			toolName?: string;
			toolType?: ToolType;
	  } & BaseEvent)
	| ({ eventType: "quote.requested" } & BaseEvent)
	| ({
			eventType: "quote.succeeded";
			quoteAmount?: number;
			quoteCurrency?: string;
	  } & BaseEvent)
	| ({ eventType: "quote.failed" } & BaseEvent)
	| ({ eventType: "link.clicked"; linkUrl?: string } & BaseEvent)
	| ({
			eventType: "purchase.completed";
			purchaseAmount?: number;
			purchaseCurrency?: string;
	  } & BaseEvent);

/**
 * Tracking module methods for WaniWaniClient
 */
export interface TrackingClient {
	/**
	 * Track an event. Pass MCP request metadata to auto-extract session, user,
	 * and location info from the provider (OpenAI, Anthropic, etc.).
	 */
	track: (event: TrackEvent) => Promise<{ eventId: string }>;
}
