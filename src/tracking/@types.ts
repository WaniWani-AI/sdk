// Tracking Module Types

// ============================================
// Event Types
// ============================================

export type EventType =
	| "tool.called"
	| "quote.requested"
	| "quote.succeeded"
	| "quote.failed"
	| "link.clicked"
	| "purchase.completed";

// ============================================
// Event Properties
// ============================================
export interface ToolCalledProperties {
	name?: string;
	type?: "pricing" | "product_info" | "availability" | "support" | "other";
}

export interface QuoteSucceededProperties {
	amount?: number;
	currency?: string;
}

export interface LinkClickedProperties {
	url?: string;
}

export interface PurchaseCompletedProperties {
	amount?: number;
	currency?: string;
}

// ============================================
// Track Event
// ============================================

interface BaseEvent {
	/**
	 * Event type.
	 *
	 * @example
	 * ```typescript
	 * wani.track({
	 *   event: 'tool.called',
	 * });
	 * ```
	 */
	event: EventType;

	/**
	 * Event properties.
	 *
	 * @example
	 * ```typescript
	 * wani.track({
	 *   event: 'tool.called',
	 *   properties: { name: 'search' },
	 * });
	 * ```
	 */
	properties?: Record<string, unknown>;
	/**
	 * MCP request metadata passed through to the API.
	 *
	 * Location varies by MCP library:
	 * - `@vercel/mcp-handler`: `extra._meta`
	 * - `@modelcontextprotocol/sdk`: `request.params._meta`
	 */
	meta?: Record<string, unknown>;
}

export type TrackEvent =
	| ({ event: "tool.called"; properties: ToolCalledProperties } & BaseEvent)
	| ({ event: "quote.requested" } & BaseEvent)
	| ({
			event: "quote.succeeded";
			properties: QuoteSucceededProperties;
	  } & BaseEvent)
	| ({ event: "quote.failed" } & BaseEvent)
	| ({ event: "link.clicked"; properties: LinkClickedProperties } & BaseEvent)
	| ({
			event: "purchase.completed";
			properties: PurchaseCompletedProperties;
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
