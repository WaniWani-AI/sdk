import type { UIMessage } from "ai";
import { SUGGESTIONS_META_KEY } from "../../../shared/meta-keys";

/** Where the pills currently on screen came from. */
export type TurnSuggestionsSource = "flow" | "streamed";

export type TurnSuggestions = {
	suggestions: string[];
	source: TurnSuggestionsSource;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isStringArray(value: unknown): value is string[] {
	return (
		Array.isArray(value) && value.every((item) => typeof item === "string")
	);
}

/**
 * Read a well-formed `waniwani/suggestions` entry off a tool part's `_meta`,
 * or `null` when the part carries no flow result or a malformed one.
 * Malformed entries (non-array `suggestions`, non-string items, a non-object
 * `_meta` entry) are never authoritative — they are garbage, not a clear.
 */
function readSuggestionsEntry(part: unknown): string[] | null {
	if (!isRecord(part) || !("toolCallId" in part) || !("output" in part)) {
		return null;
	}
	const output = part.output;
	if (!isRecord(output) || !isRecord(output._meta)) {
		return null;
	}
	const entry = output._meta[SUGGESTIONS_META_KEY];
	if (!isRecord(entry) || !isStringArray(entry.suggestions)) {
		return null;
	}
	return entry.suggestions;
}

/**
 * Read the suggestion pills the flow engine attached to a tool result.
 *
 * Every flow tool result carries the `waniwani/suggestions` key — an empty
 * array means "no pills for this step". Tool parts are identified the way
 * the renderer identifies them — by the presence of `toolCallId` and
 * `output` — rather than by a `tool-*` type string, so this survives AI SDK
 * part-type renames. Non-flow tool parts (e.g. a KB search) carry no key at
 * all and are skipped, leaving whatever the last flow part decided in place.
 *
 * A single turn can call the flow more than once (a `continue` that advances
 * through an action node into the next interrupt), so the last well-formed
 * flow entry wins — including an empty one — since it describes the step
 * the visitor is now on.
 *
 * @returns the suggestions, or `null` when the last flow entry was empty (or
 * no part carried the key at all).
 */
export function extractFlowSuggestions(message: UIMessage): string[] | null {
	let found: string[] | null = null;

	for (const part of message.parts) {
		const suggestions = readSuggestionsEntry(part);
		if (suggestions === null) {
			continue;
		}
		found = suggestions.length > 0 ? suggestions : null;
	}

	return found;
}

/**
 * Read suggestions from a streamed data part:
 * `{ type: "data-suggestions", data: { suggestions: string[] } }`.
 * Only a bring-your-own-backend host emits this; the Waniwani chat API does not.
 */
function extractStreamedSuggestions(message: UIMessage): string[] | null {
	for (const part of message.parts) {
		if (!isRecord(part)) {
			continue;
		}
		if (part.type !== "data-suggestions") {
			continue;
		}
		const data = part.data;
		if (
			isRecord(data) &&
			isStringArray(data.suggestions) &&
			data.suggestions.length > 0
		) {
			return data.suggestions;
		}
	}
	return null;
}

/**
 * Resolve the pills for a completed turn. Flow-driven suggestions win over the
 * streamed data part, which is reachable only from a self-hosted chat backend
 * and is therefore attributed like operator-authored config.
 *
 * @returns the pills and their origin, or `null` when the turn carried none.
 */
export function resolveTurnSuggestions(
	message: UIMessage,
): TurnSuggestions | null {
	const fromFlow = extractFlowSuggestions(message);
	if (fromFlow) {
		return { suggestions: fromFlow, source: "flow" };
	}

	const streamed = extractStreamedSuggestions(message);
	if (streamed) {
		return { suggestions: streamed, source: "streamed" };
	}

	return null;
}
