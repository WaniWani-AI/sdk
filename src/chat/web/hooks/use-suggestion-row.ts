"use client";

import type { ChatStatus, UIMessage } from "ai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SuggestionsConfig } from "../@types";
import type {
	PreChatSuggestions,
	SuggestionOrigin,
} from "../lib/resolve-suggestions";
import { resolveSuggestions, toSuggestions } from "../lib/resolve-suggestions";
import {
	extractFlowSuggestions,
	extractFollowupSuggestions,
} from "./turn-suggestions";

export interface UseSuggestionRowOptions {
	messages: UIMessage[];
	status: ChatStatus;
	/**
	 * The host's `suggestions` prop. `false` renders no row; `{ initial }` seeds
	 * the channel rung; already-resolved {@link PreChatSuggestions} from an
	 * embed host pass through with their prompt ids. A resolved value must be
	 * referentially stable — an effect keys on it.
	 */
	suggestions?: boolean | SuggestionsConfig | PreChatSuggestions;
}

/** An embed host's resolved rungs carry `page`/`channel`; a config carries `initial`. */
function isResolved(
	value: SuggestionsConfig | PreChatSuggestions,
): value is PreChatSuggestions {
	return "page" in value || "channel" in value;
}

function readProp(suggestions: UseSuggestionRowOptions["suggestions"]): {
	rungs?: PreChatSuggestions;
	initial?: string[];
} {
	if (typeof suggestions !== "object" || suggestions === null) {
		return {};
	}
	return isResolved(suggestions)
		? { rungs: suggestions }
		: { initial: suggestions.initial };
}

/** Pill row state, driven entirely by `resolveSuggestions`. */
export function useSuggestionRow(options: UseSuggestionRowOptions) {
	const { messages, status, suggestions } = options;
	const enabled = suggestions !== false;

	const { rungs, initial } = readProp(suggestions);
	const fromInitial = useMemo<PreChatSuggestions>(
		() => ({ page: null, channel: toSuggestions(initial ?? []) }),
		[initial],
	);
	const preChat = rungs ?? fromInitial;

	// Memoized so the `useState` initializer and the effect below share one array
	// reference. Two content-equal arrays would defeat `setPills`' bail-out and
	// double-count the `suggestions.shown` impression in `chat-embed.tsx`.
	const preChatRow = useMemo(
		() =>
			enabled
				? resolveSuggestions({ flow: null, followup: null, ...preChat })
				: null,
		[enabled, preChat],
	);
	const preChatTexts = useMemo(
		() => preChatRow?.suggestions.map((s) => s.text) ?? [],
		[preChatRow],
	);
	const [pills, setPills] = useState<string[]>(preChatTexts);
	const [source, setSource] = useState<SuggestionOrigin>(
		preChatRow?.origin ?? "channel",
	);
	const prevStatusRef = useRef<ChatStatus>(status);

	const clear = useCallback(() => {
		setPills([]);
	}, []);

	// Also covers `reset()` / `startNewThread()`, which empty `messages` without
	// unmounting: a previous conversation's flow pills would otherwise stay
	// clickable and misattribute the click to a flow never invoked here.
	const hasMessages = messages.length > 0;
	useEffect(() => {
		if (hasMessages) {
			return;
		}
		setPills(preChatTexts);
		setSource(preChatRow?.origin ?? "channel");
	}, [preChatTexts, preChatRow, hasMessages]);

	// Clear when a new user message arrives
	const lastMessage = messages[messages.length - 1];
	useEffect(() => {
		if (lastMessage?.role === "user") {
			clear();
		}
	}, [lastMessage, clear]);

	// Recompute on every streaming -> ready transition: the pills describe the
	// reply just received, so a turn carrying none clears the row.
	useEffect(() => {
		const prevStatus = prevStatusRef.current;
		prevStatusRef.current = status;

		if (prevStatus !== "streaming" || status !== "ready" || !enabled) {
			return;
		}
		const lastAssistant = [...messages]
			.reverse()
			.find((m) => m.role === "assistant");
		if (!lastAssistant) {
			return;
		}

		const flow = extractFlowSuggestions(lastAssistant);
		const followup = extractFollowupSuggestions(lastAssistant);
		const turnRow = resolveSuggestions({
			flow: flow === null ? null : toSuggestions(flow),
			followup: followup === null ? null : toSuggestions(followup),
			page: null,
			channel: null,
		});
		setPills(turnRow ? turnRow.suggestions.map((s) => s.text) : []);
		setSource(turnRow?.origin ?? "channel");
	}, [status, enabled, messages]);

	return { suggestions: pills, source, isLoading: false, clear };
}
