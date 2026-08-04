import type { UIMessage } from "ai";
import { SUGGESTIONS_META_KEY } from "../../../shared/meta-keys";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isStringArray(value: unknown): value is string[] {
	return (
		Array.isArray(value) && value.every((item) => typeof item === "string")
	);
}

/**
 * A well-formed `waniwani/suggestions` entry off a tool part's `_meta`, else
 * `null`. Malformed entries are garbage, not an authoritative clear.
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
 * The pills the flow engine attached to a tool result. Parts are matched on
 * `toolCallId` + `output` like the renderer does, not on a `tool-*` type
 * string, so AI SDK part renames don't break this.
 *
 * One turn can hit the flow twice (a `continue` through an action node), so the
 * last well-formed entry wins.
 *
 * @returns `[]` for an authoritative clear, `null` when no part carried the key.
 */
export function extractFlowSuggestions(message: UIMessage): string[] | null {
	let found: string[] | null = null;

	for (const part of message.parts) {
		const suggestions = readSuggestionsEntry(part);
		if (suggestions === null) {
			continue;
		}
		found = suggestions;
	}

	return found;
}

/**
 * Read suggestions from a streamed data part:
 * `{ type: "data-suggestions", data: { suggestions: string[] } }`.
 * Only a bring-your-own-backend host emits this; the Waniwani chat API does not.
 */
export function extractFollowupSuggestions(
	message: UIMessage,
): string[] | null {
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
