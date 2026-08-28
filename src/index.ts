// Waniwani SDK

// Error
export type {
	DocumentExtractInput,
	DocumentExtractResult,
	DocumentSchema,
	DocumentsClient,
} from "./documents/types.js";
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
export {
	ERROR_CAUSES,
	EVENT_TYPES,
	SESSION_ERROR_CODES,
} from "./tracking/@types.js";
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
