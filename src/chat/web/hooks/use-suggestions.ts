"use client";

import type { ChatStatus, UIMessage } from "ai";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SuggestionsConfig } from "../@types";
import { resolveTurnSuggestions } from "./turn-suggestions";

export interface UseSuggestionsOptions {
	messages: UIMessage[];
	status: ChatStatus;
	config?: boolean | SuggestionsConfig;
}

/** Which pill row the visitor is looking at. */
export type SuggestionsSource = "flow" | "initial";

function isConfigObject(
	config: boolean | SuggestionsConfig | undefined,
): config is SuggestionsConfig {
	return typeof config === "object" && config !== null;
}

/**
 * Whether per-turn suggestion recomputation runs at all (the streamed
 * `data-suggestions` path). Enabled when the host passes `true` or any config
 * object not setting `dynamic: false`.
 */
export function isDynamicSuggestionsEnabled(
	config: boolean | SuggestionsConfig | undefined,
): boolean {
	return (
		config === true || (isConfigObject(config) && config.dynamic !== false)
	);
}

/**
 * Whether flow-driven pills (a flow's `interrupt({ suggestions })`) may
 * render. Opt-in: the host must pass `suggestions={true}` or an object with
 * `dynamic: true`. Streamed `data-suggestions` parts are governed by
 * `isDynamicSuggestionsEnabled` instead and keep working without this.
 */
export function isFlowSuggestionsEnabled(
	config: boolean | SuggestionsConfig | undefined,
): boolean {
	return config === true || (isConfigObject(config) && config.dynamic === true);
}

/**
 * Map host-level config fields — `suggestions` (starter prompts) and
 * `dynamicSuggestions` (flow-pill opt-in) — to the `SuggestionsConfig`
 * consumed by `useSuggestions`. Every mount point (WaniwaniChat, the inline
 * and floating script embeds) must build its `ChatEmbed` suggestions prop
 * through this helper so the opt-in is never silently dropped.
 */
export function toSuggestionsConfig(options: {
	suggestions?: string[];
	dynamicSuggestions?: boolean;
}): SuggestionsConfig | undefined {
	const { suggestions, dynamicSuggestions } = options;
	if (!suggestions && dynamicSuggestions === undefined) {
		return undefined;
	}
	return { initial: suggestions, dynamic: dynamicSuggestions };
}

export function useSuggestions(options: UseSuggestionsOptions) {
	const { messages, status, config } = options;

	const initial =
		isConfigObject(config) && config.initial ? config.initial : undefined;

	const [suggestions, setSuggestions] = useState<string[]>(initial ?? []);
	const [source, setSource] = useState<SuggestionsSource>("initial");
	const prevStatusRef = useRef<ChatStatus>(status);

	const isDynamicEnabled = isDynamicSuggestionsEnabled(config);
	const isFlowEnabled = isFlowSuggestionsEnabled(config);

	const clear = useCallback(() => {
		setSuggestions([]);
	}, []);

	// Sync initial suggestions when the remote config arrives post-mount, and
	// clear whatever is on screen whenever the conversation goes back to
	// empty — a `reset()` or `startNewThread()` clears `messages` without
	// unmounting this hook, and a flow's pills from the previous conversation
	// must not survive into the new one (they'd otherwise stay clickable and
	// misattribute a click as `source: "flow"` for a flow that was never
	// invoked in this conversation).
	const hasMessages = messages.length > 0;
	useEffect(() => {
		if (!hasMessages) {
			setSuggestions(initial ?? []);
			setSource("initial");
		}
	}, [initial, hasMessages]);

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

		if (prevStatus === "streaming" && status === "ready" && isDynamicEnabled) {
			const lastAssistant = [...messages]
				.reverse()
				.find((m) => m.role === "assistant");
			if (!lastAssistant) {
				return;
			}

			const resolved = resolveTurnSuggestions(lastAssistant, {
				includeFlow: isFlowEnabled,
			});
			setSuggestions(resolved?.suggestions ?? []);
			// A streamed data part is reachable only from a self-hosted backend, so
			// it is attributed alongside operator-authored prompts, not the flow.
			setSource(resolved?.source === "flow" ? "flow" : "initial");
		}
	}, [status, isDynamicEnabled, isFlowEnabled, messages]);

	return { suggestions, source, isLoading: false, clear };
}
