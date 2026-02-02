// WaniWani SDK

// Error
export { WaniWaniError } from "./error.js";

// Types - Tracking
export type {
	EventType,
	LinkClickedProperties,
	LocationInfo,
	MCPProvider,
	NormalizedMeta,
	OpenAIMeta,
	PurchaseCompletedProperties,
	QuoteSucceededProperties,
	ToolCalledProperties,
	TrackEvent,
} from "./tracking/index.js";

// Utilities - Metadata extraction
export { detectProvider, extractMetadata } from "./tracking/index.js";

// Types - Client
export type { WaniWaniClient, WaniWaniConfig } from "./types.js";

// Main entry
export { waniwani } from "./waniwani.js";
