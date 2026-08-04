"use client";

import type { ChatStatus, UIMessage } from "ai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
	StarterSuggestions,
	SuggestionOrigin,
} from "../lib/resolve-suggestions";
import {
	resolveStarters,
	resolveSuggestions,
} from "../lib/resolve-suggestions";
import {
	extractFlowSuggestions,
	extractFollowupSuggestions,
} from "./turn-suggestions";

export interface UseSuggestionsOptions {
	messages: UIMessage[];
	status: ChatStatus;
	/** `false` renders no pill row at all. Defaults to `true`. */
	enabled?: boolean;
	/**
	 * Starter candidates shown until the first message. Must be referentially
	 * stable across renders (memoize in the caller) — an effect keys on it.
	 */
	starters?: StarterSuggestions;
}

const EMPTY_STARTERS: StarterSuggestions = { page: null, channel: [] };

/**
 * The pill row's state. Which pills render is decided exclusively by
 * `resolveSuggestions` — the fixed flow > followup > page > channel
 * hierarchy — fed with the starters while the conversation is empty and
 * with the last assistant turn's flow/followup candidates after each
 * completed exchange.
 */
export function useSuggestions(options: UseSuggestionsOptions) {
	const {
		messages,
		status,
		enabled = true,
		starters = EMPTY_STARTERS,
	} = options;

	// Memoized so the initializer below and the starter effect resolve to the
	// same array reference. Without this, `useState`'s initializer and the
	// effect's first run (mount always runs effects once) each build their own
	// `.map()` result: content-equal but reference-different, so
	// `setSuggestions` never bails out and the row fires an extra render —
	// double-counting the `suggestions.shown` impression it drives in
	// `chat-embed.tsx`.
	const starterRow = useMemo(
		() => (enabled ? resolveStarters(starters) : null),
		[enabled, starters],
	);
	const starterTexts = useMemo(
		() => starterRow?.suggestions.map((s) => s.text) ?? [],
		[starterRow],
	);
	const [suggestions, setSuggestions] = useState<string[]>(starterTexts);
	const [source, setSource] = useState<SuggestionOrigin>(
		starterRow?.origin ?? "channel",
	);
	const prevStatusRef = useRef<ChatStatus>(status);

	const clear = useCallback(() => {
		setSuggestions([]);
	}, []);

	// Starter row while the conversation is empty. Also runs when a `reset()`
	// or `startNewThread()` clears `messages` without unmounting this hook —
	// a flow's pills from the previous conversation must not survive into the
	// new one (they'd stay clickable and misattribute a click as origin
	// `"flow"` for a flow that was never invoked in this conversation).
	const hasMessages = messages.length > 0;
	useEffect(() => {
		if (hasMessages) {
			return;
		}
		setSuggestions(starterTexts);
		setSource(starterRow?.origin ?? "channel");
	}, [starterTexts, starterRow, hasMessages]);

	// Clear when a new user message arrives
	const lastMessage = messages[messages.length - 1];
	useEffect(() => {
		if (lastMessage?.role === "user") {
			clear();
		}
	}, [lastMessage, clear]);

	// Recompute on every streaming -> ready transition. The pills always
	// describe the reply the visitor just received, so a turn that carries no
	// suggestions clears the row rather than leaving stale options on screen.
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

		const resolved = resolveSuggestions({
			flow: extractFlowSuggestions(lastAssistant),
			followup: extractFollowupSuggestions(lastAssistant),
			starters: null,
		});
		setSuggestions(resolved ? resolved.suggestions.map((s) => s.text) : []);
		setSource(resolved?.origin ?? "channel");
	}, [status, enabled, messages]);

	return { suggestions, source, isLoading: false, clear };
}
