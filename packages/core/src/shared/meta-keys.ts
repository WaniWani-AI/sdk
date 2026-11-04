/**
 * `_meta` keys shared between the MCP server surface and the browser chat
 * bundle. Kept in `shared/` so both import the same string literal instead of
 * duplicating it, without the chat bundle pulling in server code.
 */

/**
 * Suggested answers for the flow's current step. Every flow tool result
 * carries this key — a non-empty array only when the step has exactly one
 * open question (the only case where a single pill is an unambiguous
 * answer), an empty array otherwise. The chat widget renders a non-empty
 * array as pills and treats the key's presence, empty or not, as
 * authoritative for the turn; other MCP hosts ignore the key.
 */
export const SUGGESTIONS_META_KEY = "waniwani/suggestions" as const;

/** Shape stored under {@link SUGGESTIONS_META_KEY}. */
export type SuggestionsMeta = {
	suggestions: string[];
};
