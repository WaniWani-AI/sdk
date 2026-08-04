"use client";

import type { ChatStatus, UIMessage } from "ai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SuggestionsConfig } from "../@types";
import type {
	ConfiguredSuggestions,
	SuggestionOrigin,
} from "../lib/resolve-suggestions";
import { resolveSuggestions, toSuggestions } from "../lib/resolve-suggestions";
import {
	extractFlowSuggestions,
	extractFollowupSuggestions,
} from "./turn-suggestions";

export interface UseSuggestionsOptions {
	messages: UIMessage[];
	status: ChatStatus;
	/** `false` renders no pill row; an object's `initial` seeds `channel`. */
	suggestions?: boolean | SuggestionsConfig;
	/**
	 * Page-aware rungs from an embed host's `/config`. Wins over
	 * `suggestions.initial`. Must be referentially stable — an effect keys on it.
	 */
	configured?: ConfiguredSuggestions;
}

/** Pill row state, driven entirely by `resolveSuggestions`. */
export function useSuggestions(options: UseSuggestionsOptions) {
	const { messages, status, suggestions: config, configured } = options;
	const enabled = config !== false;

	const initial =
		typeof config === "object" && config !== null ? config.initial : undefined;
	const fromProp = useMemo<ConfiguredSuggestions>(
		() => ({ page: null, channel: toSuggestions(initial ?? []) }),
		[initial],
	);
	const preChat = configured ?? fromProp;

	// Memoized so the `useState` initializer and the effect below share one array
	// reference. Two content-equal arrays would defeat `setSuggestions`' bail-out
	// and double-count the `suggestions.shown` impression in `chat-embed.tsx`.
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
	const [suggestions, setSuggestions] = useState<string[]>(preChatTexts);
	const [source, setSource] = useState<SuggestionOrigin>(
		preChatRow?.origin ?? "channel",
	);
	const prevStatusRef = useRef<ChatStatus>(status);

	const clear = useCallback(() => {
		setSuggestions([]);
	}, []);

	// Also covers `reset()` / `startNewThread()`, which empty `messages` without
	// unmounting: a previous conversation's flow pills would otherwise stay
	// clickable and misattribute the click to a flow never invoked here.
	const hasMessages = messages.length > 0;
	useEffect(() => {
		if (hasMessages) {
			return;
		}
		setSuggestions(preChatTexts);
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
		const resolved = resolveSuggestions({
			flow: flow === null ? null : toSuggestions(flow),
			followup: followup === null ? null : toSuggestions(followup),
			page: null,
			channel: null,
		});
		setSuggestions(resolved ? resolved.suggestions.map((s) => s.text) : []);
		setSource(resolved?.origin ?? "channel");
	}, [status, enabled, messages]);

	return { suggestions, source, isLoading: false, clear };
}
