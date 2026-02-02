// Tracking Module

import { WaniWaniError } from "../error.js";
import type { InternalConfig } from "../types.js";
import type { TrackEvent, TrackingClient } from "./@types.js";

// Re-export types
export type {
	EventType,
	ToolType,
	TrackEvent,
	TrackingClient,
} from "./@types.js";

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

				const response = await fetch(`${baseUrl}/api/mcp/events`, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${apiKey}`,
					},
					body: JSON.stringify(event),
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

		async getOrCreateSession(meta?: Record<string, unknown>): Promise<string> {
			if (meta) {
				const sessionId =
					meta["openai/sessionId"] || meta.sessionId || meta.conversationId;
				if (typeof sessionId === "string" && sessionId.length > 0) {
					return sessionId;
				}
			}

			const sessionId = crypto.randomUUID();
			await this.track({ eventType: "session.started", sessionId });
			return sessionId;
		},
	};
}
