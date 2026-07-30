"use client";

import type { ChatStatus, UIMessage } from "ai";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SuggestionOrigin, SuggestionsConfig } from "../@types";
import { resolveTurnSuggestions } from "./turn-suggestions";

export interface UseSuggestionsOptions {
	messages: UIMessage[];
	status: ChatStatus;
	config?: boolean | SuggestionsConfig;
}

function isConfigObject(
	config: boolean | SuggestionsConfig | undefined,
): config is SuggestionsConfig {
	return typeof config === "object" && config !== null;
}

/**
 * Default origins allowed to fill the pill row when the host passes no
 * config at all: starter prompts and generated follow-ups render, flow-driven
 * pills stay opt-in.
 */
export const DEFAULT_SUGGESTION_ORIGINS: readonly SuggestionOrigin[] = [
	"channel",
	"page",
	"followup",
];

const ALL_SUGGESTION_ORIGINS: readonly SuggestionOrigin[] = [
	"channel",
	"page",
	"flow",
	"followup",
];

/**
 * Resolve which origins may fill the pill row for a given host config.
 *
 * Priority: `false` → none; `true` → every origin; an object's `origins`
 * (when present, even empty) wins outright; otherwise the legacy `dynamic`
 * boolean (`true` → every origin, `false` → none); anything else (including
 * `undefined`) falls back to {@link DEFAULT_SUGGESTION_ORIGINS}.
 */
export function resolveSuggestionOrigins(
	config: boolean | SuggestionsConfig | undefined,
): SuggestionOrigin[] {
	if (config === false) {
		return [];
	}
	if (config === true) {
		return [...ALL_SUGGESTION_ORIGINS];
	}
	if (isConfigObject(config)) {
		if (config.origins !== undefined) {
			return config.origins;
		}
		if (config.dynamic === true) {
			return [...ALL_SUGGESTION_ORIGINS];
		}
		if (config.dynamic === false) {
			return [];
		}
	}
	return [...DEFAULT_SUGGESTION_ORIGINS];
}

/** Whether a given origin may fill the pill row for a given host config. */
export function isOriginEnabled(
	config: boolean | SuggestionsConfig | undefined,
	origin: SuggestionOrigin,
): boolean {
	return resolveSuggestionOrigins(config).includes(origin);
}

/**
 * Map host-level config fields — `suggestions` (starter prompts) and
 * `suggestionOrigins` (which providers may fill the per-turn pill row) — to
 * the `SuggestionsConfig` consumed by `useSuggestions`. Every mount point
 * (WaniwaniChat, the inline and floating script embeds) must build its
 * `ChatEmbed` suggestions prop through this helper so the origin config is
 * never silently dropped.
 */
export function toSuggestionsConfig(options: {
	suggestions?: string[];
	suggestionOrigins?: SuggestionOrigin[];
}): SuggestionsConfig | undefined {
	const { suggestions, suggestionOrigins } = options;
	if (!suggestions && suggestionOrigins === undefined) {
		return undefined;
	}
	return { initial: suggestions, origins: suggestionOrigins };
}

export function useSuggestions(options: UseSuggestionsOptions) {
	const { messages, status, config } = options;

	const initial =
		isConfigObject(config) && config.initial ? config.initial : undefined;

	const [suggestions, setSuggestions] = useState<string[]>(initial ?? []);
	const [source, setSource] = useState<SuggestionOrigin>("channel");
	const prevStatusRef = useRef<ChatStatus>(status);

	const origins = resolveSuggestionOrigins(config);
	const isFlowEnabled = origins.includes("flow");
	const isFollowupEnabled = origins.includes("followup");

	const clear = useCallback(() => {
		setSuggestions([]);
	}, []);

	// Sync initial suggestions when the remote config arrives post-mount, and
	// clear whatever is on screen whenever the conversation goes back to
	// empty — a `reset()` or `startNewThread()` clears `messages` without
	// unmounting this hook, and a flow's pills from the previous conversation
	// must not survive into the new one (they'd otherwise stay clickable and
	// misattribute a click as origin `"flow"` for a flow that was never
	// invoked in this conversation).
	const hasMessages = messages.length > 0;
	useEffect(() => {
		if (!hasMessages) {
			setSuggestions(initial ?? []);
			setSource("channel");
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

		if (
			prevStatus === "streaming" &&
			status === "ready" &&
			(isFlowEnabled || isFollowupEnabled)
		) {
			const lastAssistant = [...messages]
				.reverse()
				.find((m) => m.role === "assistant");
			if (!lastAssistant) {
				return;
			}

			const resolved = resolveTurnSuggestions(lastAssistant, {
				includeFlow: isFlowEnabled,
			});
			// A resolved origin not enabled for this host (e.g. a flow result
			// when only `followup` is enabled) is treated as no suggestions.
			const enabled =
				resolved &&
				((resolved.source === "flow" && isFlowEnabled) ||
					(resolved.source === "followup" && isFollowupEnabled));
			setSuggestions(enabled ? resolved.suggestions : []);
			setSource(enabled ? resolved.source : "channel");
		}
	}, [status, isFlowEnabled, isFollowupEnabled, messages]);

	return { suggestions, source, isLoading: false, clear };
}
