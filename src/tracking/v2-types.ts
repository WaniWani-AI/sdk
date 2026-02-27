import type { EventType, LegacyTrackEvent } from "./@types.js";

export type V2EnvelopeType = "mcp.event";

export interface V2CorrelationIds {
	sessionId?: string;
	traceId?: string;
	requestId?: string;
	correlationId?: string;
	externalUserId?: string;
}

export interface V2EventEnvelope {
	id: string;
	type: V2EnvelopeType;
	name: EventType;
	source: string;
	timestamp: string;
	correlation: V2CorrelationIds;
	properties: Record<string, unknown>;
	metadata: Record<string, unknown>;
	rawLegacy?: LegacyTrackEvent;
}

export interface V2BatchRequest {
	sentAt: string;
	source: {
		sdk: string;
		version?: string;
	};
	events: V2EventEnvelope[];
}

export interface V2BatchRejectedEvent {
	eventId: string;
	code: string;
	message?: string;
	retryable?: boolean;
}

export interface V2BatchResponse {
	accepted: number;
	rejected?: V2BatchRejectedEvent[];
	requestId?: string;
}
