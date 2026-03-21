import {
	extractCorrelationId,
	extractExternalUserId,
	extractRequestId,
	extractSessionId,
	extractTraceId,
} from "../mcp/server/utils.js";
import type { EventType, LegacyTrackEvent, TrackInput } from "./@types.js";
import type { V2CorrelationIds, V2EventEnvelope } from "./v2-types.js";

const DEFAULT_SOURCE = "@waniwani/sdk";

export interface MapTrackEventOptions {
	now?: () => Date;
	generateId?: () => string;
	source?: string;
}

export function mapTrackEventToV2(
	input: TrackInput,
	options: MapTrackEventOptions = {},
): V2EventEnvelope {
	const now = options.now ?? (() => new Date());
	const generateId = options.generateId ?? createEventId;
	const eventName = resolveEventName(input);
	const meta = toRecord(input.meta);
	const metadata = toRecord(input.metadata);
	const correlation = resolveCorrelationIds(input, meta);
	const eventId = takeNonEmptyString(input.eventId) ?? generateId();
	const timestamp = normalizeTimestamp(input.timestamp, now);
	const source =
		takeNonEmptyString(input.source) ?? options.source ?? DEFAULT_SOURCE;
	const rawLegacy = isLegacyTrackEvent(input) ? { ...input } : undefined;

	const mappedMetadata: Record<string, unknown> = {
		...metadata,
	};
	if (Object.keys(meta).length > 0) {
		mappedMetadata.meta = meta;
	}
	if (rawLegacy) {
		mappedMetadata.rawLegacy = rawLegacy;
	}

	return {
		id: eventId,
		type: "mcp.event",
		name: eventName,
		source,
		timestamp,
		correlation,
		properties: mapProperties(input, eventName),
		metadata: mappedMetadata,
		rawLegacy,
	};
}

export function createEventId(): string {
	if (
		typeof crypto !== "undefined" &&
		typeof crypto.randomUUID === "function"
	) {
		return `evt_${crypto.randomUUID()}`;
	}

	return `evt_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}

function mapProperties(
	input: TrackInput,
	eventName: EventType,
): Record<string, unknown> {
	if (!isLegacyTrackEvent(input)) {
		return toRecord(input.properties);
	}

	const legacyProperties = mapLegacyProperties(input, eventName);
	const explicitProperties = toRecord(input.properties);
	return {
		...legacyProperties,
		...explicitProperties,
	};
}

function mapLegacyProperties(
	input: LegacyTrackEvent,
	eventName: EventType,
): Record<string, unknown> {
	switch (eventName) {
		case "tool.called": {
			const properties: Record<string, unknown> = {};
			if (takeNonEmptyString(input.toolName)) {
				properties.name = input.toolName;
			}
			if (takeNonEmptyString(input.toolType)) {
				properties.type = input.toolType;
			}
			return properties;
		}
		case "quote.succeeded": {
			const properties: Record<string, unknown> = {};
			if (typeof input.quoteAmount === "number") {
				properties.amount = input.quoteAmount;
			}
			if (takeNonEmptyString(input.quoteCurrency)) {
				properties.currency = input.quoteCurrency;
			}
			return properties;
		}
		case "link.clicked": {
			const properties: Record<string, unknown> = {};
			if (takeNonEmptyString(input.linkUrl)) {
				properties.url = input.linkUrl;
			}
			return properties;
		}
		case "purchase.completed": {
			const properties: Record<string, unknown> = {};
			if (typeof input.purchaseAmount === "number") {
				properties.amount = input.purchaseAmount;
			}
			if (takeNonEmptyString(input.purchaseCurrency)) {
				properties.currency = input.purchaseCurrency;
			}
			return properties;
		}
		default:
			return {};
	}
}

function resolveEventName(input: TrackInput): EventType {
	if (isLegacyTrackEvent(input)) {
		return input.eventType;
	}
	return input.event;
}

function resolveCorrelationIds(
	input: TrackInput,
	meta: Record<string, unknown>,
): V2CorrelationIds {
	const requestId =
		takeNonEmptyString(input.requestId) ?? extractRequestId(meta);

	const sessionId =
		takeNonEmptyString(input.sessionId) ?? extractSessionId(meta);

	const traceId = takeNonEmptyString(input.traceId) ?? extractTraceId(meta);

	const externalUserId =
		takeNonEmptyString(input.externalUserId) ?? extractExternalUserId(meta);

	const correlationId =
		takeNonEmptyString(input.correlationId) ??
		extractCorrelationId(meta) ??
		requestId;

	const correlation: V2CorrelationIds = {};
	if (sessionId) {
		correlation.sessionId = sessionId;
	}
	if (traceId) {
		correlation.traceId = traceId;
	}
	if (requestId) {
		correlation.requestId = requestId;
	}
	if (correlationId) {
		correlation.correlationId = correlationId;
	}
	if (externalUserId) {
		correlation.externalUserId = externalUserId;
	}
	return correlation;
}

function normalizeTimestamp(
	input: string | Date | undefined,
	now: () => Date,
): string {
	if (input instanceof Date) {
		return input.toISOString();
	}
	if (typeof input === "string") {
		const date = new Date(input);
		if (!Number.isNaN(date.getTime())) {
			return date.toISOString();
		}
	}
	return now().toISOString();
}

function toRecord(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return {};
	}
	return value as Record<string, unknown>;
}

function takeNonEmptyString(value: unknown): string | undefined {
	if (typeof value !== "string") {
		return undefined;
	}
	if (value.trim().length === 0) {
		return undefined;
	}
	return value;
}

function isLegacyTrackEvent(input: TrackInput): input is LegacyTrackEvent {
	return "eventType" in input;
}
