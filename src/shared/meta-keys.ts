/**
 * `_meta` keys shared between the MCP server surface and the browser chat
 * bundle. Kept in `shared/` so both import the same string literal instead of
 * duplicating it, without the chat bundle pulling in server code.
 */

/**
 * Suggested answers for the flow's current step. Present only when the step
 * has exactly one open question, which is the only case where a single pill
 * is an unambiguous answer. The chat widget renders these as pills; other MCP
 * hosts ignore the key.
 */
export const SUGGESTIONS_META_KEY = "waniwani/suggestions" as const;

/** Shape stored under {@link SUGGESTIONS_META_KEY}. */
export type SuggestionsMeta = {
	suggestions: string[];
};
