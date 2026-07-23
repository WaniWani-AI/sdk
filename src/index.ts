// Waniwani SDK

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
export type { WaniWaniProjectConfig } from "./project-config.js";
// Project Config
export { defineConfig } from "./project-config.js";
// Tracking
export { EVENT_TYPES } from "./tracking/@types.js";
export type {
	FrontendClientOptions,
	FrontendIdentity,
	FrontendTrackingClient,
} from "./tracking/frontend.js";
export { createFrontendClient } from "./tracking/frontend.js";
// Types - Tracking
export type {
	ComparedPriceOption,
	ConvertedProperties,
	EventType,
	LeadQualifiedProperties,
	LegacyTrackEvent,
	LinkClickedProperties,
	OptionSelectedProperties,
	PriceShownProperties,
	PricesComparedProperties,
	PurchaseCompletedProperties,
	QuoteSucceededProperties,
	RevenueConvertedInput,
	RevenueLeadQualifiedInput,
	RevenueOptionSelectedInput,
	RevenuePriceShownInput,
	RevenuePricesComparedInput,
	RevenueTrackingApi,
	ToolCalledProperties,
	TrackEvent,
	TrackFn,
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
