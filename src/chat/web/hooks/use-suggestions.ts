"use client";

import type { ChatStatus, UIMessage } from "ai";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SuggestionsConfig } from "../@types";

export interface UseSuggestionsOptions {
	messages: UIMessage[];
	status: ChatStatus;
	config?: boolean | SuggestionsConfig;
}

/**
 * Extract suggestions from the last assistant message's data part.
 * The API streams a `data-suggestions` part at the end of the response:
 * `{ type: "data-suggestions", data: { suggestions: string[] } }`
 */
function extractSuggestions(message: UIMessage): string[] | null {
	for (const part of message.parts) {
		const p = part as Record<string, unknown>;
		// Handle both "data-suggestions" and generic "data" part types
		if (p.type === "data" || p.type === "data-suggestions") {
			const data = p.data as Record<string, unknown> | undefined;
			if (data && Array.isArray(data.suggestions)) {
				return data.suggestions as string[];
			}
		}
	}
	return null;
}

function isConfigObject(
	config: boolean | SuggestionsConfig | undefined,
): config is SuggestionsConfig {
	return typeof config === "object" && config !== null && "initial" in config;
}

export function useSuggestions(options: UseSuggestionsOptions) {
	const { messages, status, config } = options;

	const [suggestions, setSuggestions] = useState<string[]>(
		(isConfigObject(config) && config.initial ? config.initial : []) ?? [],
	);
	const prevStatusRef = useRef<ChatStatus>(status);

	const isEnabled = Boolean(config);

	const clear = useCallback(() => {
		setSuggestions([]);
	}, []);

	// Clear when a new user message arrives
	const lastMessage = messages[messages.length - 1];
	useEffect(() => {
		if (lastMessage?.role === "user") {
			clear();
		}
	}, [lastMessage, clear]);

	// Extract suggestions from message parts on streaming → ready transition
	useEffect(() => {
		const prevStatus = prevStatusRef.current;
		prevStatusRef.current = status;

		if (prevStatus === "streaming" && status === "ready" && isEnabled) {
			const lastAssistant = [...messages]
				.reverse()
				.find((m) => m.role === "assistant");
			if (!lastAssistant) return;

			console.log("[WaniWani] Assistant parts:", lastAssistant.parts);

			const extracted = extractSuggestions(lastAssistant);
			console.log("[WaniWani] Extracted suggestions:", extracted);
			if (extracted) {
				setSuggestions(extracted);
			}
		}
	}, [status, isEnabled, messages]);

	return { suggestions, isLoading: false, clear };
}
