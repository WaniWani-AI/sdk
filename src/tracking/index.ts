// Tracking Module

import type { InternalConfig } from "../types.js";
import type {
	TrackInput,
	TrackingClient,
	TrackingShutdownOptions,
} from "./@types.js";
import { mapTrackEventToV2 } from "./mapper.js";
import { createV2BatchTransport } from "./transport.js";

// Re-export types
export type {
	EventType,
	LegacyTrackEvent,
	LinkClickedProperties,
	PurchaseCompletedProperties,
	QuoteSucceededProperties,
	ToolCalledProperties,
	TrackEvent,
	TrackInput,
	TrackingClient,
	TrackingConfig,
	TrackingShutdownOptions,
	TrackingShutdownResult,
} from "./@types.js";
export { createEventId, mapTrackEventToV2 } from "./mapper.js";
export type {
	V2BatchRejectedEvent,
	V2BatchRequest,
	V2BatchResponse,
	V2CorrelationIds,
	V2EnvelopeType,
	V2EventEnvelope,
} from "./v2-types.js";

export function createTrackingClient(config: InternalConfig): TrackingClient {
	const { baseUrl, apiKey, tracking } = config;

	function requireApiKey(): string {
		if (!apiKey) {
			throw new Error("WANIWANI_API_KEY is not set");
		}
		return apiKey;
	}

	const transport = apiKey
		? createV2BatchTransport({
				baseUrl,
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

	const client: TrackingClient = {
		async identify(
			userId: string,
			properties?: Record<string, unknown>,
		): Promise<{ eventId: string }> {
			requireApiKey();
			const mappedEvent = mapTrackEventToV2({
				event: "user.identified",
				externalUserId: userId,
				properties,
			});
			transport?.enqueue(mappedEvent);
			return { eventId: mappedEvent.id };
		},
		async track(event: TrackInput): Promise<{ eventId: string }> {
			requireApiKey();
			const mappedEvent = mapTrackEventToV2(event);
			transport?.enqueue(mappedEvent);
			return { eventId: mappedEvent.id };
		},
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
