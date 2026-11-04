import type { WidgetMode } from "../embed/widget-events";
import { eventsEndpoint } from "./page-view";
import type { Suggestion, SuggestionOrigin } from "./resolve-suggestions";
import { getOrCreateVisitorId } from "./visitor-context";

export interface FireSuggestionClickOptions {
	/** Chat API base, e.g. `https://app.waniwani.ai/api/mcp/chat`. */
	api: string;
	/** Public token (`wwp_...`). */
	token: string;
	channelId?: string;
	mode?: WidgetMode;
	/** Same tag `page.viewed` carries, from the resolved `/config`. Omitted when absent; the click still attributes via `properties.channelId`. */
	source?: string;
	/** Usually absent: a starter prompt is normally the click that starts the conversation. */
	sessionId?: string;
	/** Stored id of the authored prompt, `null` when it has no identity. */
	promptId: string | null;
	origin: SuggestionOrigin;
	text: string;
	/** Position in the rendered list, from the widget event. */
	index: number;
}

/** An authored per-page prompt keeps its stored id; a fixed-list prompt has none. Two identical texts attribute to the first match, duplicates within a page being pathological authoring. */
export function resolveSuggestionId(
	list: Suggestion[],
	text: string,
): string | null {
	return list.find((s) => s.text === text)?.id ?? null;
}

interface PostSuggestionEventOptions {
	api: string;
	token: string;
	name: "suggestion.clicked" | "suggestion.shown";
	source?: string;
	sessionId?: string;
	properties: Record<string, unknown>;
}

/** Envelope and POST shared by both suggestion events. Fire-and-forget: resolves once the request is dispatched (or skipped) and never throws, so a tracking failure stays away from the host page. */
async function postSuggestionEvent(
	opts: PostSuggestionEventOptions,
): Promise<void> {
	const { api, token, name, source, sessionId, properties } = opts;
	if (typeof window === "undefined" || !api || !token) {
		return;
	}

	const endpoint = eventsEndpoint(api);
	if (!endpoint) {
		return;
	}

	try {
		const now = new Date().toISOString();
		const body = JSON.stringify({
			sentAt: now,
			source: { sdk: "@waniwani/sdk", version: "0.1.0" },
			events: [
				{
					id: crypto.randomUUID(),
					type: "mcp.event",
					name,
					source,
					timestamp: now,
					correlation: { visitorId: getOrCreateVisitorId(), sessionId },
					properties: {
						...properties,
						// Raw href, same as `page.viewed`; normalized at query time.
						url: window.location.href,
					},
					metadata: {},
				},
			],
		});

		await fetch(endpoint, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${token}`,
			},
			body,
			// A click submits a message and may navigate; keep the send alive.
			keepalive: true,
		});
	} catch {
		// Never surface a tracking failure. A dropped event is a dropped event.
	}
}

export async function fireSuggestionClick(
	opts: FireSuggestionClickOptions,
): Promise<void> {
	const {
		api,
		token,
		channelId,
		mode,
		source,
		sessionId,
		promptId,
		origin,
		text,
		index,
	} = opts;
	await postSuggestionEvent({
		api,
		token,
		name: "suggestion.clicked",
		source,
		sessionId,
		properties: {
			promptId,
			origin,
			// Org-authored copy, DLP-redacted server-side regardless.
			text,
			index,
			channelId,
			mode,
		},
	});
}

/** One entry per pill. The set's origin rides on the widget event that reported it, the pill row having resolved it at render time. */
export function resolveShownSuggestions(
	list: Suggestion[],
	texts: string[],
): Suggestion[] {
	return texts.map((text) => ({ id: resolveSuggestionId(list, text), text }));
}

export interface FireSuggestionShownOptions {
	api: string;
	token: string;
	channelId?: string;
	mode?: WidgetMode;
	source?: string;
	sessionId?: string;
	prompts: Suggestion[];
	origin: SuggestionOrigin;
}

/** One event per rendered set, with the per-prompt ids in `properties.prompts`, so per-prompt impressions stay queryable while a three-pill render costs one row. */
export async function fireSuggestionShown(
	opts: FireSuggestionShownOptions,
): Promise<void> {
	const { api, token, channelId, mode, source, sessionId, prompts, origin } =
		opts;
	if (prompts.length === 0) {
		return;
	}
	await postSuggestionEvent({
		api,
		token,
		name: "suggestion.shown",
		source,
		sessionId,
		properties: {
			prompts,
			count: prompts.length,
			origin,
			channelId,
			mode,
		},
	});
}
