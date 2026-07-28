// ============================================================================
// Suggestion-click event — fired every time a visitor clicks a starter prompt.
//
// This is what makes authored per-page prompts measurable: the event carries
// the prompt's stored id in `properties.promptId`, so a click attributes back
// to the prompt that earned it. Page-level CTR is clicks ÷ `page.viewed`.
//
// Same canonical ingest, envelope, and auth as `page.viewed`
// (`POST /api/mcp/events/v2/batch` with the public `wwp_` token) — see
// `page-view.ts` for why no widget JWT is involved. Two differences: there is
// no once-per-page guard (every click counts, and clicking submits the message
// and clears the pills, so clicks are naturally rate-limited), and identity is
// the synchronous `getOrCreateVisitorId()` — the device/referrer context rides
// on `page.viewed` already, so there is nothing to await here.
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

/**
 * Emit a `suggestion.clicked` event for one starter-prompt click.
 * Fire-and-forget: resolves once the request is dispatched (or skipped) and
 * never throws — tracking must never break the host page or the widget.
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
					name: "suggestion.clicked",
					source,
					timestamp: now,
					// `sessionId` is dropped by JSON.stringify while undefined, so a
					// click that precedes the first exchange carries visitor id only.
					correlation: { visitorId: getOrCreateVisitorId(), sessionId },
					properties: {
						promptId,
						kind,
						// Org-authored copy, and DLP-redacted server-side regardless.
						text,
						index,
						channelId,
						mode,
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
			// The click submits a message and may navigate; keep the send alive.
			keepalive: true,
		});
	} catch {
		// Never surface a tracking failure. A dropped click is a dropped click.
	}
}
