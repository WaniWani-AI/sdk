import { useCallback, useRef } from "react";

interface TrackingConfig {
	apiKey?: string;
	baseUrl?: string;
}

/**
 * Lightweight browser-compatible tracking hook for chat events.
 * Fires events to the WaniWani API without requiring the full tracking client
 * (which depends on process.env).
 */
export function useChatTracking(config: TrackingConfig) {
	const configRef = useRef(config);
	configRef.current = config;

	const trackEvent = useCallback(
		(event: string, properties?: Record<string, unknown>) => {
			const { apiKey, baseUrl = "https://app.waniwani.ai" } = configRef.current;
			if (!apiKey) return;

			fetch(`${baseUrl}/api/mcp/events`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${apiKey}`,
				},
				body: JSON.stringify({
					event,
					properties,
				}),
			}).catch(() => {
				// Silently fail - tracking should never break the chat
			});
		},
		[],
	);

	const trackChatOpened = useCallback(() => {
		trackEvent("tool.called", { name: "chat.opened", type: "other" });
	}, [trackEvent]);

	const trackMessageSent = useCallback(() => {
		trackEvent("tool.called", { name: "chat.message_sent", type: "other" });
	}, [trackEvent]);

	const trackResponseReceived = useCallback(() => {
		trackEvent("tool.called", {
			name: "chat.response_received",
			type: "other",
		});
	}, [trackEvent]);

	return { trackChatOpened, trackMessageSent, trackResponseReceived };
}
