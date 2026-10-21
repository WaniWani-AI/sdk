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
	/** Stamped as `properties.channelId`. A getter lets a token-only embed pick the channel up once the remote `/config` lands. */
	channelId?: string | (() => string | undefined);
	getSource: () => string | undefined;
	/** Server-assigned session id, read live (undefined before the first message). */
	getSessionId: () => string | undefined;
}

/** Backs `chat.track` / `ChatHandle.track`. */
export function createChatTrackClient(
	options: CreateChatTrackClientOptions,
): FrontendTrackingClient {
	const endpoint = eventsEndpoint(options.api);
	if (!endpoint) {
		return createNoopChatTrackClient(
			"the chat api does not point at a Waniwani event ingest",
		);
	}
	return createFrontendClient({
		endpoint,
		token: options.token,
		channelId: options.channelId,
		source: options.getSource,
		// Per event, never captured once: the first event predates any session, and `setVisitorId()` can land between two events.
		identity: () => ({
			sessionId: options.getSessionId(),
			visitorId: getOrCreateVisitorId(),
		}),
	});
}

/** Stand-in for surfaces with nowhere to send: warns once, then silently discards every call so the host page keeps working. */
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
