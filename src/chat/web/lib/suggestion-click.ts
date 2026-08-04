// ============================================================================
// Suggestion events — `suggestion.clicked` for every starter-prompt click and
// `suggestion.shown` for every pill set the visitor actually saw.
//
// Together they make authored per-page prompts measurable per prompt id: a
// click attributes back to the prompt that earned it (`properties.promptId`),
// a shown set records which prompts had the chance to earn one
// (`properties.prompts`), and per-prompt CTR is clicks(id) ÷ shown sets
// containing that id. A shown set is one event carrying all its pills, not an
// event per pill.
//
// Same canonical ingest, envelope, and auth as `page.viewed`
// (`POST /api/mcp/events/v2/batch` with the public `wwp_` token) — see
// `page-view.ts` for why no widget JWT is involved. Two differences: there is
// no once-per-page guard (the render/click sites own their own dedupe — a
// click submits the message and clears the pills, a shown set is keyed on the
// resolved list's identity), and identity is the synchronous
// `getOrCreateVisitorId()` — the device/referrer context rides on
// `page.viewed` already, so there is nothing to await here.
//
// Both events carry `properties.origin`, the same `SuggestionOrigin` taxonomy
// the `suggestion.clicked` widget event exposes to host pages. The pill row
// resolves that origin exactly at render time (flow > followup > page >
// channel), so it rides straight through from the widget event.
// ============================================================================

import { eventsEndpoint } from "./page-view";
import type { Suggestion, SuggestionOrigin } from "./resolve-suggestions";
import { getOrCreateVisitorId } from "./visitor-context";

export interface FireSuggestionClickOptions {
	/** Chat API base, e.g. `https://app.waniwani.ai/api/mcp/chat`. */
	api: string;
	/** Public token (`wwp_...`). */
	token: string;
	/** Agent channel ID, when known. */
	channelId?: string;
	/** Embed surface the click happened on. */
	mode?: "inline" | "floating";
	/**
	 * Channel-specific event source from the resolved `/config`, same tag
	 * `page.viewed` carries. Omitted from the event entirely when absent — the
	 * click still attributes to its channel via `properties.channelId`.
	 */
	source?: string;
	/**
	 * Conversation session id when one exists. Usually absent: a starter prompt
	 * is normally the click that *starts* the conversation.
	 */
	sessionId?: string;
	/** Stored id of the authored prompt, `null` when it has no identity. */
	promptId: string | null;
	origin: SuggestionOrigin;
	/** The clicked prompt text. */
	text: string;
	/** Position in the rendered list, from the widget event. */
	index: number;
}

/**
 * Attribute a prompt text back to the starter list that rendered it: an
 * authored per-page prompt keeps its stored id, a fixed-list prompt has
 * none. Two identical texts attribute to the first match — duplicate texts
 * within a page are pathological authoring, not worth plumbing the rendered
 * index through for.
 */
export function resolvePromptId(
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

/**
 * Envelope + POST shared by both suggestion events. Fire-and-forget: resolves
 * once the request is dispatched (or skipped) and never throws — tracking must
 * never break the host page or the widget.
 */
async function postSuggestionEvent(
	opts: PostSuggestionEventOptions,
): Promise<void> {
	const { api, token, name, source, sessionId, properties } = opts;
	if (typeof window === "undefined" || !api || !token) {
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
					// `sessionId` is dropped by JSON.stringify while undefined, so an
					// event that precedes the first exchange carries visitor id only.
					correlation: { visitorId: getOrCreateVisitorId(), sessionId },
					properties: {
						...properties,
						// Raw href, same as `page.viewed` — normalized at query time.
						url: window.location.href,
					},
					metadata: {},
				},
			],
		});

		await fetch(eventsEndpoint(api), {
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

/**
 * Emit a `suggestion.clicked` event for one starter-prompt click.
 */
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
			// Org-authored copy, and DLP-redacted server-side regardless.
			text,
			index,
			channelId,
			mode,
		},
	});
}

/**
 * Attribute a rendered set back to the list that resolved it, one entry
 * per pill. The set's origin rides on the widget event that reported it —
 * the pill row resolves its origin exactly at render time.
 */
export function resolveShownPrompts(
	list: Suggestion[],
	texts: string[],
): Suggestion[] {
	return texts.map((text) => ({ id: resolvePromptId(list, text), text }));
}

export interface FireSuggestionShownOptions {
	api: string;
	token: string;
	channelId?: string;
	mode?: "inline" | "floating";
	source?: string;
	sessionId?: string;
	prompts: Suggestion[];
	origin: SuggestionOrigin;
}

/**
 * Emit one `suggestion.shown` event for a rendered pill set. One event per
 * set, not per pill: the per-prompt ids ride in `properties.prompts`, so
 * per-prompt impressions stay queryable while a three-pill render costs one
 * row.
 */
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
