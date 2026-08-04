// ============================================================================
// Suggestion resolution — the single source of truth for which pills render.
//
// The pill row obeys one fixed hierarchy, strongest first:
//   flow > followup > page > channel
// The hierarchy is not configurable: hosts cannot enable or disable
// individual origins. A flow entry is authoritative even when empty — `[]`
// clears the row instead of letting follow-ups or stale pills through.
// ============================================================================

/**
 * Every place a suggestion pill can come from. The single source of truth:
 * {@link SuggestionOrigin} derives from it, so adding an origin is a
 * one-line change.
 */
export const SUGGESTION_ORIGINS = [
	"channel",
	"page",
	"flow",
	"followup",
] as const;

/** Where a suggestion pill came from. */
export type SuggestionOrigin = (typeof SUGGESTION_ORIGINS)[number];

/** One starter prompt; `id` is null for fixed-list prompts (no stored identity). */
export interface PageSuggestion {
	id: string | null;
	text: string;
}

/** Starter prompt candidates, shown until the visitor's first message. */
export interface StarterSuggestions {
	/** Picked prompts for the matched page; `null` when no page matches. */
	page: PageSuggestion[] | null;
	/** The channel's fixed starter prompts. */
	channel: string[];
}

/** Everything that may fill the pill row at a given moment. */
export interface SuggestionCandidates {
	/**
	 * The turn's last flow `_meta` entry. `[]` is an authoritative clear
	 * (the flow says: no pills on this step); `null` means the turn carried
	 * no flow entry at all.
	 */
	flow: string[] | null;
	/** The turn's streamed `data-suggestions` part; `null` when absent. */
	followup: string[] | null;
	/** Starter candidates; `null` once the conversation has started. */
	starters: StarterSuggestions | null;
}

/** The winning pill set and the origin that supplied it. */
export interface ResolvedSuggestions {
	origin: SuggestionOrigin;
	suggestions: PageSuggestion[];
}

function toPageSuggestions(texts: string[]): PageSuggestion[] {
	return texts.map((text) => ({ id: null, text }));
}

/**
 * Resolve the starter row: the matched page's picked prompts when there are
 * any, else the channel's fixed prompts, else nothing.
 */
export function resolveStarters(
	starters: StarterSuggestions,
): ResolvedSuggestions | null {
	if (starters.page && starters.page.length > 0) {
		return { origin: "page", suggestions: starters.page };
	}
	if (starters.channel.length > 0) {
		return {
			origin: "channel",
			suggestions: toPageSuggestions(starters.channel),
		};
	}
	return null;
}

/**
 * Apply the fixed hierarchy to a set of candidates. A present flow entry wins
 * outright — including an empty one, which renders no pills AND suppresses
 * every weaker origin. Starters only participate while the conversation is
 * empty (callers pass `starters: null` once it has started).
 */
export function resolveSuggestions(
	candidates: SuggestionCandidates,
): ResolvedSuggestions | null {
	if (candidates.flow !== null) {
		return { origin: "flow", suggestions: toPageSuggestions(candidates.flow) };
	}
	if (candidates.followup !== null && candidates.followup.length > 0) {
		return {
			origin: "followup",
			suggestions: toPageSuggestions(candidates.followup),
		};
	}
	if (candidates.starters) {
		return resolveStarters(candidates.starters);
	}
	return null;
}
