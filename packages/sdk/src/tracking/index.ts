// Tracking Module

import type {
	TrackFn,
	TrackInput,
	TrackingClient,
	TrackingShutdownOptions,
} from "@waniwani/protocol/tracking/@types";
import { mapTrackEventToV2 } from "@waniwani/protocol/tracking/mapper";
import { createRevenueApi } from "@waniwani/protocol/tracking/revenue";
import { createV2BatchTransport } from "@waniwani/protocol/tracking/transport";
import type { InternalConfig } from "../types.js";

// Re-export types
export type {
	CallableTrack,
	ComparedPriceOption,
	ConvertedProperties,
	ErrorCauseType,
	EventType,
	LeadQualifiedProperties,
	LegacyTrackEvent,
	LinkClickedProperties,
	OptionSelectedProperties,
	PriceShownProperties,
	PricesComparedProperties,
	RevenueConvertedInput,
	RevenueLeadQualifiedInput,
	RevenueOptionSelectedInput,
	RevenuePriceShownInput,
	RevenuePricesComparedInput,
	RevenueTrackingApi,
	SessionErrorCodeType,
	SessionErrorProperties,
	ToolCalledProperties,
	TrackEvent,
	TrackFn,
	TrackInput,
	TrackingClient,
	TrackingConfig,
	TrackingShutdownOptions,
	TrackingShutdownResult,
} from "@waniwani/protocol/tracking/@types";
export {
	ERROR_CAUSES,
	EVENT_TYPES,
	SESSION_ERROR_CODES,
} from "@waniwani/protocol/tracking/@types";
export {
	createEventId,
	mapTrackEventToV2,
} from "@waniwani/protocol/tracking/mapper";
export type {
	V2BatchRejectedEvent,
	V2BatchRequest,
	V2BatchResponse,
	V2CorrelationIds,
	V2EnvelopeType,
	V2EventEnvelope,
} from "@waniwani/protocol/tracking/v2-types";

export function createTrackingClient(config: InternalConfig): TrackingClient {
	const { apiUrl, apiKey, tracking } = config;

	function requireApiKey(): string {
		if (!apiKey) {
			throw new Error("WANIWANI_API_KEY is not set");
		}
		return apiKey;
	}

	const transport = apiKey
		? createV2BatchTransport({
				apiUrl,
				apiKey,
				endpointPath: tracking.endpointPath,
				flushIntervalMs: tracking.flushIntervalMs,
				maxBatchSize: tracking.maxBatchSize,
				maxBufferSize: tracking.maxBufferSize,
				maxRetries: tracking.maxRetries,
				retryBaseDelayMs: tracking.retryBaseDelayMs,
				retryMaxDelayMs: tracking.retryMaxDelayMs,
				shutdownTimeoutMs: tracking.shutdownTimeoutMs,
			})
		: undefined;

	// Single enqueue path shared by track(), track.* revenue helpers, and identify().
	function emit(event: TrackInput): { eventId: string } {
		requireApiKey();
		const mappedEvent = mapTrackEventToV2(event);
		// Identity is required server-side (sessionId, externalUserId, or
		// visitorId, possibly derived from meta). Warn early: without it the
		// ingest API rejects the event even though enqueue returns an id here.
		if (
			!mappedEvent.correlation.sessionId &&
			!mappedEvent.correlation.externalUserId &&
			!mappedEvent.correlation.visitorId
		) {
			console.warn(
				`[waniwani] event "${mappedEvent.name}" has no sessionId, externalUserId, or visitorId; ` +
					"the ingest API requires one and will reject it.",
			);
		}
		transport?.enqueue(mappedEvent);
		return { eventId: mappedEvent.id };
	}

	const trackOnce = async (event: TrackInput): Promise<{ eventId: string }> =>
		emit(event);
	// Revenue helpers attach flat onto `track` (track.priceShown(), …).
	const track: TrackFn = Object.assign(trackOnce, createRevenueApi(trackOnce));

	const client: TrackingClient = {
		async identify(
			userId: string,
			properties?: Record<string, unknown>,
			meta?: Record<string, unknown>,
		): Promise<{ eventId: string }> {
			requireApiKey();
			const mappedEvent = mapTrackEventToV2({
				event: "user.identified",
				externalUserId: userId,
				properties,
				meta,
			});
			transport?.enqueue(mappedEvent);
			return { eventId: mappedEvent.id };
		},
		track,
		async flush(): Promise<void> {
			requireApiKey();
			await transport?.flush();
		},
		async shutdown(options?: TrackingShutdownOptions) {
			requireApiKey();
			return (
				(await transport?.shutdown({
					timeoutMs: options?.timeoutMs ?? tracking.shutdownTimeoutMs,
				})) ?? { timedOut: false, pendingEvents: 0 }
			);
		},
	};

	if (transport) {
		attachShutdownHooks(client, tracking.shutdownTimeoutMs);
	}
	return client;
}

function attachShutdownHooks(
	client: TrackingClient,
	defaultTimeoutMs: number,
): void {
	if (
		typeof process === "undefined" ||
		typeof process.once !== "function" ||
		typeof process.on !== "function"
	) {
		return;
	}

	const shutdown = () => {
		void client.shutdown({ timeoutMs: defaultTimeoutMs });
	};

	process.once("beforeExit", shutdown);
	process.once("SIGINT", shutdown);
	process.once("SIGTERM", shutdown);
}
