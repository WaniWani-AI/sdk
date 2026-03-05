// WaniWani SDK

// Error
export { WaniWaniError } from "./error.js";

// Types - KB Client
export type {
	KbClient,
	KbIngestFile,
	KbIngestResult,
	KbSearchOptions,
	KbSource,
} from "./kb/types.js";

// Types - Tracking
export type {
	EventType,
	LegacyTrackEvent,
	LinkClickedProperties,
	PurchaseCompletedProperties,
	QuoteSucceededProperties,
	ToolCalledProperties,
	TrackEvent,
	TrackInput,
	TrackingConfig,
	TrackingShutdownOptions,
	TrackingShutdownResult,
	V2BatchRejectedEvent,
	V2BatchRequest,
	V2BatchResponse,
	V2CorrelationIds,
	V2EnvelopeType,
	V2EventEnvelope,
} from "./tracking/index.js";

// Types - Client
export type { WaniWaniClient, WaniWaniConfig } from "./types.js";

// Main entry
export { waniwani } from "./waniwani.js";
