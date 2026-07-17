// Tracking Module Types

import type { KbSearchTrace } from "../kb/types.js";

// ============================================
// Event Types
// ============================================

export type EventType =
	| "session.started"
	| "page.viewed"
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
	// Revenue taxonomy (WAN-387) — typed first-class revenue events.
	| "price_shown"
	| "prices_compared"
	| "option_selected"
	| "lead"
	| "converted";

// ============================================
// Event Properties
// ============================================

/**
 * Properties for `page.viewed` — emitted once when the chat widget initializes
 * on a host page (the top of the funnel). Attributed to the anonymous
 * `visitorId` (mapped to `externalUserId`), never to a session: a page view
 * must not create a session, otherwise sessions would equal page views and the
 * "landed → started a conversation" funnel collapses.
 */
export interface PageViewedProperties {
	/** Full URL of the host page the widget loaded on. */
	url?: string;
	/** Referrer of the host page, if any. */
	referrer?: string;
	/** Embed mode the widget initialized in. */
	mode?: "inline" | "floating";
	/** Resolved device type from the visitor context. */
	deviceType?: "mobile" | "tablet" | "desktop";
	/** Primary browser language (BCP-47). */
	language?: string;
	/** IANA timezone of the visitor. */
	timezone?: string;
}

export interface ToolCalledProperties {
	name?: string;
	type?: "pricing" | "product_info" | "availability" | "support" | "other";
	/** Retrieval traces for kb.search() calls made inside this tool handler. */
	kbSearch?: KbSearchTrace[];
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
// Revenue Taxonomy Properties (WAN-387)
// ============================================

export interface PriceShownProperties {
	amount: number;
	currency: string;
	itemId?: string;
	label?: string;
}

export interface ComparedPriceOption {
	id: string;
	amount: number;
	currency: string;
}

export interface PricesComparedProperties {
	options: ComparedPriceOption[];
}

export interface OptionSelectedProperties {
	id: string;
	amount: number;
	currency: string;
}

export interface LeadProperties {
	source?: string;
}

export interface ConvertedProperties {
	amount: number;
	currency: string;
	/** When the conversion actually happened — for backdated off-platform sales. */
	occurredAt?: string;
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
			event: "page.viewed";
			properties?: PageViewedProperties;
	  } & BaseTrackEvent)
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
			event: "price_shown";
			properties?: PriceShownProperties;
	  } & BaseTrackEvent)
	| ({
			event: "prices_compared";
			properties?: PricesComparedProperties;
	  } & BaseTrackEvent)
	| ({
			event: "option_selected";
			properties?: OptionSelectedProperties;
	  } & BaseTrackEvent)
	| ({ event: "lead"; properties?: LeadProperties } & BaseTrackEvent)
	| ({
			event: "converted";
			properties?: ConvertedProperties;
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
// Revenue Helper Inputs (WAN-386)
// ============================================

// Each helper input is its typed properties plus the shared tracking context
// (sessionId / externalUserId / meta / …). At least one identity field
// (sessionId or externalUserId, possibly derived from `meta`) must be present —
// the ingest API rejects events without one.

export interface RevenuePriceShownInput
	extends TrackingContext,
		PriceShownProperties {}

export interface RevenuePricesComparedInput
	extends TrackingContext,
		PricesComparedProperties {}

export interface RevenueOptionSelectedInput
	extends TrackingContext,
		OptionSelectedProperties {}

/**
 * Input for `track.lead()`. `source` is the lead's acquisition source
 * (the `lead` event property, e.g. "newsletter") — on this helper it shadows
 * the envelope `source` from the tracking context. To set a custom envelope
 * source on a lead, use the generic `track({ event: "lead", … })`.
 */
export interface RevenueLeadInput extends TrackingContext, LeadProperties {}

export interface RevenueConvertedInput
	extends TrackingContext,
		ConvertedProperties {}

/**
 * Revenue-oriented helpers, flat on `client.track.*` (e.g.
 * `client.track.priceShown()`, `client.track.converted()`). Decoupled from
 * product primitives — each maps to a typed first-class revenue event.
 */
export interface RevenueTrackingApi {
	priceShown: (input: RevenuePriceShownInput) => Promise<{ eventId: string }>;
	pricesCompared: (
		input: RevenuePricesComparedInput,
	) => Promise<{ eventId: string }>;
	optionSelected: (
		input: RevenueOptionSelectedInput,
	) => Promise<{ eventId: string }>;
	lead: (input?: RevenueLeadInput) => Promise<{ eventId: string }>;
	converted: (input: RevenueConvertedInput) => Promise<{ eventId: string }>;
}

/**
 * The callable form of `track` — emit one event, without the flat revenue
 * helpers. What internal code and custom/injected trackers need; lets them
 * avoid implementing the revenue methods.
 */
export type CallableTrack = (event: TrackInput) => Promise<{ eventId: string }>;

/**
 * `client.track` — callable for generic events (`track(event)`), with the
 * revenue helpers attached flat: `track.priceShown()`, `track.lead()`,
 * `track.converted()`, etc.
 */
export interface TrackFn extends RevenueTrackingApi {
	(event: TrackInput): Promise<{ eventId: string }>;
}

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
	 *
	 * Also exposes the revenue helpers flat: `client.track.priceShown()`,
	 * `client.track.lead()`, `client.track.converted()`, etc.
	 */
	track: TrackFn;
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
