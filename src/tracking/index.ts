// Tracking Module

import { WaniWaniError } from "../error.js";
import type { InternalConfig } from "../types.js";
import type { TrackEvent, TrackingClient } from "./@types.js";
import { extractMetadata } from "./metadata.js";

// Re-export types
export type {
	EventType,
	LocationInfo,
	MCPProvider,
	NormalizedMeta,
	OpenAIMeta,
	ToolType,
	TrackEvent,
	TrackingClient,
} from "./@types.js";

// Re-export metadata utilities
export { detectProvider, extractMetadata } from "./metadata.js";

export function createTrackingClient(config: InternalConfig): TrackingClient {
	const { baseUrl, apiKey } = config;

	function checkIfApiKeyIsSet() {
		if (!apiKey) {
			throw new Error("WANIWANI_API_KEY is not set");
		}
	}

	return {
		async track(event: TrackEvent): Promise<{ eventId: string }> {
			try {
				checkIfApiKeyIsSet();

				// Extract provider-specific fields from meta if present
				const normalized = event.meta ? extractMetadata(event.meta) : null;

				// Build payload with extracted fields
				const payload = {
					...event,
					// normalized metadata from the provider
					...(normalized ? { ...normalized } : {}),
				};

				const response = await fetch(`${baseUrl}/api/mcp/events`, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${apiKey}`,
					},
					body: JSON.stringify(payload),
				});

				const data = await response.json();

				if (!response.ok) {
					throw new WaniWaniError(
						data.message ?? "Request failed",
						response.status,
					);
				}

				return { eventId: data.data.eventId };
			} catch (error) {
				console.error("[WaniWani] Track error:", error);
				throw error;
			}
		},
	};
}
