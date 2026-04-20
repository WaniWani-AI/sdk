// Tracking Module Types

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
	| "purchase.completed"
	// Widget auto-capture events
	| "widget_render"
	| "widget_click"
	| "widget_link_click"
	| "widget_error"
	| "widget_scroll"
	| "widget_form_field"
	| "widget_form_submit"
	| "user.identified"
	| "flow.node_reached";

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
// Legacy + Modern Track Inputs
// ============================================

interface TrackingContext {
	/**
	 * MCP request metadata passed through to the API.
	 *
	 * Location varies by MCP library:
	 * - `@vercel/mcp-handler`: `extra._meta`
	 * - `@modelcontextprotocol/sdk`: `request.params._meta`
	 */
	meta?: Record<string, unknown>;
	/** Legacy metadata field supported for backward compatibility. */
	metadata?: Record<string, unknown>;
	/** Optional explicit correlation fields. */
	sessionId?: string;
	traceId?: string;
	requestId?: string;
	correlationId?: string;
	externalUserId?: string;
	/** Optional explicit envelope fields. */
	eventId?: string;
	timestamp?: string | Date;
	source?: string;
}

/**
 * Modern tracking shape (preferred).
 */
interface BaseTrackEvent extends TrackingContext {
	event: EventType;
	properties?: Record<string, unknown>;
}

export type TrackEvent =
	| ({ event: "session.started" } & BaseTrackEvent)
	| ({
			event: "tool.called";
			properties?: ToolCalledProperties;
	  } & BaseTrackEvent)
	| ({ event: "quote.requested" } & BaseTrackEvent)
	| ({
			event: "quote.succeeded";
			properties?: QuoteSucceededProperties;
	  } & BaseTrackEvent)
	| ({ event: "quote.failed" } & BaseTrackEvent)
	| ({
			event: "link.clicked";
			properties?: LinkClickedProperties;
	  } & BaseTrackEvent)
	| ({
			event: "purchase.completed";
			properties?: PurchaseCompletedProperties;
	  } & BaseTrackEvent)
	| ({ event: "user.identified" } & BaseTrackEvent)
	| ({
			event: "flow.node_reached";
			properties?: { flowId?: string; nodeId?: string };
	  } & BaseTrackEvent);

/**
 * Legacy tracking shape supported for existing integrations.
 */
export interface LegacyTrackEvent extends TrackingContext {
	eventType: EventType;
	properties?: Record<string, unknown>;
	toolName?: string;
	toolType?: ToolCalledProperties["type"];
	quoteAmount?: number;
	quoteCurrency?: string;
	linkUrl?: string;
	purchaseAmount?: number;
	purchaseCurrency?: string;
}

/**
 * Public track input accepted by `client.track()`.
 */
export type TrackInput = TrackEvent | LegacyTrackEvent;

// ============================================
// Runtime Config
// ============================================

export interface TrackingConfig {
	/** Events API V2 endpoint path. */
	endpointPath?: string;
	/** Periodic flush interval for buffered events. */
	flushIntervalMs?: number;
	/** Max events per HTTP batch send. */
	maxBatchSize?: number;
	/** Max in-memory buffer size before oldest items are dropped. */
	maxBufferSize?: number;
	/** Number of retries for retryable failures. */
	maxRetries?: number;
	/** Retry backoff base delay. */
	retryBaseDelayMs?: number;
	/** Retry backoff max delay. */
	retryMaxDelayMs?: number;
	/** Default shutdown timeout when none is provided. */
	shutdownTimeoutMs?: number;
}

export interface TrackingShutdownOptions {
	timeoutMs?: number;
}

export interface TrackingShutdownResult {
	timedOut: boolean;
	pendingEvents: number;
}

// ============================================
// Client
// ============================================

/**
 * Tracking module methods for WaniWaniClient.
 */
export interface TrackingClient {
	/**
	 * Send a one-shot identify event for a user.
	 * userId can be any string: an email, an internal ID, etc.
	 */
	identify: (
		userId: string,
		properties?: Record<string, unknown>,
		meta?: Record<string, unknown>,
	) => Promise<{ eventId: string }>;
	/**
	 * Track an event using modern or legacy input shape.
	 * Returns a deterministic event id immediately after enqueue.
	 */
	track: (event: TrackInput) => Promise<{ eventId: string }>;
	/**
	 * Flush all currently buffered events.
	 */
	flush: () => Promise<void>;
	/**
	 * Flush and stop the transport.
	 */
	shutdown: (
		options?: TrackingShutdownOptions,
	) => Promise<TrackingShutdownResult>;
}
