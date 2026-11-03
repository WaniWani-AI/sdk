import type {
	TrackFn,
	TrackInput,
	TrackingShutdownOptions,
	TrackingShutdownResult,
} from "./@types.js";
import { mapTrackEventToV2 } from "./mapper.js";
import { createRevenueApi } from "./revenue.js";
import { createV2BatchTransport } from "./transport.js";

/**
 * Correlation identity read at emit time, so identifiers that only exist
 * later (a server-assigned chat session id, for example) are picked up on
 * every event without re-creating the client.
 */
export interface FrontendIdentity {
	sessionId?: string;
	visitorId?: string;
	externalUserId?: string;
	traceId?: string;
}

export interface FrontendClientOptions {
	/**
	 * Full URL of the events ingest endpoint
	 * (e.g. `https://app.waniwani.ai/api/mcp/events/v2/batch`).
	 */
	endpoint: string;
	/**
	 * Browser-safe credential: an environment public token (`wwp_...`) or a
	 * widget JWT injected by `withWaniwani` into tool response `_meta`. Omit
	 * only when the endpoint is your own unauthenticated proxy route.
	 */
	token?: string;
	/**
	 * Channel attribution stamped on every event (e.g. `"chatgpt"`, `"web"`).
	 * The ingest API rejects events it cannot attribute to a channel, so set
	 * this (or `channelId`) unless every event carries its own. Accepts a
	 * getter for values that resolve after client creation.
	 */
	source?: string | (() => string | undefined);
	/**
	 * Exact channel attribution, stamped as `properties.channelId` on every
	 * event that does not set its own. Accepts a getter for values that
	 * resolve after client creation.
	 */
	channelId?: string | (() => string | undefined);
	/** Live identity, called on every emit. */
	identity?: () => FrontendIdentity;
	/** Extra fields merged into every event's envelope metadata. */
	metadata?: Record<string, unknown>;
	/** Periodic flush interval for buffered events. */
	flushIntervalMs?: number;
}

/**
 * The browser counterpart of the server tracking client: the exact same
 * `track` surface (callable plus the flat revenue helpers) over the same
 * batching transport, with identity stamped automatically.
 */
export interface FrontendTrackingClient {
	track: TrackFn;
	/**
	 * Attach a stable external user id. Emits `user.identified` and stamps
	 * `externalUserId` on every subsequent event from this client.
	 */
	identify(
		userId: string,
		properties?: Record<string, unknown>,
	): Promise<{ eventId: string }>;
	flush(): Promise<void>;
	shutdown(options?: TrackingShutdownOptions): Promise<TrackingShutdownResult>;
}

/**
 * Create a tracking client for browser surfaces (MCP-app widgets, the chat
 * embed, or any page holding a `wwp_` public token). Events flush in batches,
 * survive page navigation via keepalive teardown, and never throw into the
 * host page.
 */
export function createFrontendClient(
	options: FrontendClientOptions,
): FrontendTrackingClient {
	const { apiUrl, endpointPath } = splitEndpoint(options.endpoint);
	const transport = createV2BatchTransport({
		apiUrl,
		apiKey: options.token,
		endpointPath,
		flushIntervalMs: options.flushIntervalMs,
	});

	let identifiedUserId: string | undefined;

	const resolve = (
		value: string | (() => string | undefined) | undefined,
	): string | undefined => (typeof value === "function" ? value() : value);

	const emit = async (event: TrackInput): Promise<{ eventId: string }> => {
		const identity = options.identity?.() ?? {};
		const channelId = resolve(options.channelId);
		const properties =
			channelId === undefined
				? event.properties
				: { channelId, ...event.properties };
		const mapped = mapTrackEventToV2(
			{
				sessionId: identity.sessionId,
				visitorId: identity.visitorId,
				externalUserId: identity.externalUserId ?? identifiedUserId,
				traceId: identity.traceId,
				...event,
				properties,
				metadata: { ...options.metadata, ...event.metadata },
			} as TrackInput,
			{ source: resolve(options.source) },
		);
		transport.enqueue(mapped);
		return { eventId: mapped.id };
	};

	return {
		track: Object.assign(emit, createRevenueApi(emit)),
		identify(userId, properties) {
			identifiedUserId = userId;
			return emit({
				event: "user.identified",
				externalUserId: userId,
				properties,
			});
		},
		flush: () => transport.flush(),
		shutdown: (shutdownOptions) => transport.shutdown(shutdownOptions),
	};
}

function splitEndpoint(endpoint: string): {
	apiUrl: string;
	endpointPath: string;
} {
	const url = new URL(endpoint);
	return { apiUrl: url.origin, endpointPath: `${url.pathname}${url.search}` };
}
