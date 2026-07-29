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
// ============================================================================

import type { PageSuggestion } from "../embed/use-page-suggestions";
import { eventsEndpoint } from "./page-view";
import { getOrCreateVisitorId } from "./visitor-context";

/** Where the clicked prompt came from. */
export type SuggestionKind = "page" | "fallback" | "followup";

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
	kind: SuggestionKind;
	/** The clicked prompt text. */
	text: string;
	/** Position in the rendered list, from the widget event. */
	index: number;
}

/**
 * Attribute a clicked prompt text back to the list it was rendered from: an
 * authored per-page prompt keeps its stored id (`kind: "page"`), one from the
 * channel's fixed list has none (`kind: "fallback"`).
 *
 * Two identical texts on one page attribute to the first match. Duplicate
 * texts within a page are pathological authoring, not worth plumbing the
 * rendered index through for.
 */
export function resolveClickAttribution(
	list: PageSuggestion[],
	text: string,
): { promptId: string | null; kind: SuggestionKind } {
	const match = list.find((s) => s.text === text);
	if (!match) {
		// ponytail: not in the current page list → treat as a followup. Today the
		// WaniWani server never streams followups so this is near-unreachable
		// (only a click racing an SPA-nav refetch); generated follow-ups make it
		// real.
		return { promptId: null, kind: "followup" };
	}
	return { promptId: match.id, kind: match.id ? "page" : "fallback" };
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
		kind,
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
			kind,
			// Org-authored copy, and DLP-redacted server-side regardless.
			text,
			index,
			channelId,
			mode,
		},
	});
}

/** A prompt as it appeared in a rendered set, for impression logging. */
export interface ShownPrompt {
	id: string | null;
	text: string;
}

/**
 * Attribute a rendered set back to the list it was resolved from, one entry
 * per pill. The set-level `kind` is the first pill's: rendered sets are
 * homogeneous (a page row is all-authored, the fixed list all-null, streamed
 * follow-ups absent from the list entirely), so a mixed set only arises from
 * a render racing an SPA-nav refetch and the first pill is as truthful as any.
 */
export function resolveShownPrompts(
	list: PageSuggestion[],
	texts: string[],
): { prompts: ShownPrompt[]; kind: SuggestionKind } {
	const prompts = texts.map((text) => ({
		id: resolveClickAttribution(list, text).promptId,
		text,
	}));
	const kind: SuggestionKind =
		texts.length > 0 ? resolveClickAttribution(list, texts[0]).kind : "page";
	return { prompts, kind };
}

export interface FireSuggestionShownOptions {
	api: string;
	token: string;
	channelId?: string;
	mode?: "inline" | "floating";
	source?: string;
	sessionId?: string;
	prompts: ShownPrompt[];
	kind: SuggestionKind;
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
	const { api, token, channelId, mode, source, sessionId, prompts, kind } =
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
			kind,
			channelId,
			mode,
		},
	});
}
