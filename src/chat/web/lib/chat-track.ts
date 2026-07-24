// ============================================================================
// Host-page tracking client for the chat widget.
//
// The chat surfaces (the `<script>` embed and `WaniwaniChat`) already hold
// everything tracking needs: the public `wwp_` token, the channel, and the
// server-assigned session id. This wires those into the shared frontend
// tracking client so host pages get the same `track` surface as the server
// (`track({ event })`, `track.converted()`, ...) with identity attached
// automatically: `sessionId` once the first exchange assigns one, the
// anonymous `visitorId` before that.
// ============================================================================

import {
	createFrontendClient,
	type FrontendTrackingClient,
} from "../../../tracking/frontend";
import { eventsEndpoint } from "./page-view";
import { getOrCreateVisitorId } from "./visitor-context";

export interface CreateChatTrackClientOptions {
	/** Chat API base, e.g. `https://app.waniwani.ai/api/mcp/chat`. */
	api: string;
	/** Public token (`wwp_...`). */
	token: string;
	/** Agent channel ID, when known. Stamped as `properties.channelId`. */
	channelId?: string;
	/**
	 * Channel-specific event source, read live so the value from the resolved
	 * remote `/config` is picked up once the fetch lands.
	 */
	getSource: () => string | undefined;
	/** Server-assigned session id, read live (undefined before the first message). */
	getSessionId: () => string | undefined;
}

/**
 * Create the tracking client backing `chat.track` / `ChatHandle.track`.
 */
export function createChatTrackClient(
	options: CreateChatTrackClientOptions,
): FrontendTrackingClient {
	return createFrontendClient({
		endpoint: eventsEndpoint(options.api),
		token: options.token,
		channelId: options.channelId,
		source: options.getSource,
		// Resolve the visitor id per event (not captured once) so it is present
		// on the first event before any session exists, and so a host-supplied
		// override via `setVisitorId()` is reflected on later events.
		identity: () => ({
			sessionId: options.getSessionId(),
			visitorId: getOrCreateVisitorId(),
		}),
	});
}

/**
 * Tracking client stand-in for surfaces missing their `wwp_` token: warns
 * once, then silently discards every call so the host page never breaks.
 */
export function createNoopChatTrackClient(
	reason: string,
): FrontendTrackingClient {
	let warned = false;
	const emit = async (): Promise<{ eventId: string }> => {
		if (!warned) {
			warned = true;
			console.warn(`[Waniwani] track() is disabled: ${reason}`);
		}
		return { eventId: "" };
	};
	return {
		track: Object.assign(emit, {
			priceShown: emit,
			pricesCompared: emit,
			optionSelected: emit,
			leadQualified: emit,
			converted: emit,
		}),
		identify: emit,
		flush: async () => {},
		shutdown: async () => ({ timedOut: false, pendingEvents: 0 }),
	};
}
