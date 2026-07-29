import type { UIMessage } from "ai";
import { SUGGESTIONS_META_KEY } from "../../../shared/meta-keys";

/** Where the pills currently on screen came from. */
export type SuggestionsSource = "flow" | "initial";

export type TurnSuggestions = {
	suggestions: string[];
	source: SuggestionsSource;
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
 * Read the suggestion pills the flow engine attached to a tool result.
 *
 * Tool parts are identified the way the renderer identifies them — by the
 * presence of `toolCallId` and `output` — rather than by a `tool-*` type
 * string, so this survives AI SDK part-type renames.
 *
 * A single turn can call the flow more than once (a `continue` that advances
 * through an action node into the next interrupt), so the last result wins:
 * it describes the step the visitor is now on.
 *
 * @returns the suggestions, or `null` when this turn carried none.
 */
export function extractFlowSuggestions(message: UIMessage): string[] | null {
	let found: string[] | null = null;

	for (const part of message.parts) {
		if (!isRecord(part) || !("toolCallId" in part) || !("output" in part)) {
			continue;
		}
		const output = part.output;
		if (!isRecord(output) || !isRecord(output._meta)) {
			continue;
		}
		const entry = output._meta[SUGGESTIONS_META_KEY];
		if (!isRecord(entry)) {
			continue;
		}
		if (isStringArray(entry.suggestions) && entry.suggestions.length > 0) {
			found = entry.suggestions;
		}
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
		return { suggestions: streamed, source: "initial" };
	}

	return null;
}
