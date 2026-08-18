// ============================================================================
// Which pills render. One fixed, non-configurable hierarchy:
//   flow > followup > page > channel
//
// The shipped wire formats keep their older wording on purpose: the event
// payloads say `promptId` / `prompts`, the `/config` payload says
// `pageSuggestions[].prompts`. Both are contracts, not naming.
// ============================================================================

/** Source of truth; {@link SuggestionOrigin} derives from it. */
export const SUGGESTION_ORIGINS = [
	"channel",
	"page",
	"flow",
	"followup",
] as const;

export type SuggestionOrigin = (typeof SUGGESTION_ORIGINS)[number];

/** One pill. `id` is null unless it came from an authored per-page prompt. */
export interface Suggestion {
	id: string | null;
	text: string;
}

/**
 * One field per origin. `null` means the origin has nothing to say — no entry
 * on this turn, or the rung no longer applies.
 *
 * `flow` alone treats `[]` as authoritative: it clears the row and suppresses
 * every weaker rung. Elsewhere `[]` and `null` are the same.
 */
export interface SuggestionCandidates {
	flow: Suggestion[] | null;
	followup: Suggestion[] | null;
	page: Suggestion[] | null;
	channel: Suggestion[] | null;
}

/**
 * The rungs an embed host reads from `/config`. Grouped because they share a
 * source and a lifetime: both stop applying at the visitor's first message.
 */
export type PreChatSuggestions = Pick<SuggestionCandidates, "page" | "channel">;

export interface ResolvedSuggestions {
	origin: SuggestionOrigin;
	suggestions: Suggestion[];
}

/** Wrap raw texts, which carry no stored identity. */
export function toSuggestions(texts: string[]): Suggestion[] {
	return texts.map((text) => ({ id: null, text }));
}

/** Walk the hierarchy. See {@link SuggestionCandidates} for the `[]` rules. */
export function resolveSuggestions(
	candidates: SuggestionCandidates,
): ResolvedSuggestions | null {
	const { flow, followup, page, channel } = candidates;
	if (flow !== null) {
		return { origin: "flow", suggestions: flow };
	}
	if (followup?.length) {
		return { origin: "followup", suggestions: followup };
	}
	if (page?.length) {
		return { origin: "page", suggestions: page };
	}
	if (channel?.length) {
		return { origin: "channel", suggestions: channel };
	}
	return null;
}
