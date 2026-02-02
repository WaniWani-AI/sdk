// Tracking Module Types

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
	sessionId: string;
	externalUserId?: string;
	metadata?: Record<string, unknown>;
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
	 * Track an event using the WaniWani API
	 */
	track: (event: TrackEvent) => Promise<{ eventId: string }>;
	/**
	 * Extract session ID from MCP request metadata, or generate a new one.
	 * If a new session ID is generated, automatically tracks a session.started event.
	 *
	 * @param meta - The _meta object from the MCP request (extra?._meta)
	 * @returns The session ID (existing or newly generated)
	 */
	getOrCreateSession: (meta?: Record<string, unknown>) => Promise<string>;
}
