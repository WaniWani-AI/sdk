"use client";

import type { ChatStatus, UIMessage } from "ai";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SuggestionsConfig } from "../@types";

export interface UseSuggestionsOptions {
	messages: UIMessage[];
	status: ChatStatus;
	initialSuggestions?: string[];
	suggestions?: boolean | SuggestionsConfig;
	/** Chat API endpoint — used to derive the suggestions URL */
	api?: string;
	apiKey?: string;
	headers?: Record<string, string>;
}

/**
 * Derive the suggestions API URL from the chat API endpoint.
 * "/api/chat" → "/api/mcp/suggestions"
 * "https://app.waniwani.ai/api/chat" → "https://app.waniwani.ai/api/mcp/suggestions"
 */
function deriveSuggestionsUrl(api: string): string {
	try {
		const url = new URL(api);
		url.pathname = "/api/mcp/suggestions";
		return url.toString();
	} catch {
		// Relative URL — use same origin
		return "/api/mcp/suggestions";
	}
}

export function useSuggestions(options: UseSuggestionsOptions) {
	const {
		messages,
		status,
		initialSuggestions,
		suggestions: suggestionsConfig,
		api = "https://app.waniwani.ai/api/chat",
		apiKey,
		headers: userHeaders,
	} = options;

	const [suggestions, setSuggestions] = useState<string[]>([]);
	const [isLoading, setIsLoading] = useState(false);
	const prevStatusRef = useRef<ChatStatus>(status);
	const abortRef = useRef<AbortController | null>(null);

	const isEnabled = Boolean(suggestionsConfig);
	const count =
		typeof suggestionsConfig === "object" ? (suggestionsConfig.count ?? 3) : 3;

	const hasUserMessages = messages.some((m) => m.role === "user");
	const suggestionsUrl = deriveSuggestionsUrl(api);

	const clear = useCallback(() => {
		setSuggestions([]);
		abortRef.current?.abort();
		abortRef.current = null;
	}, []);

	// Show initial suggestions when no user messages exist
	useEffect(() => {
		if (!hasUserMessages && initialSuggestions?.length) {
			setSuggestions(initialSuggestions);
		}
	}, [hasUserMessages, initialSuggestions]);

	// Clear when a new user message arrives
	const lastMessage = messages[messages.length - 1];
	useEffect(() => {
		if (lastMessage?.role === "user") {
			clear();
		}
	}, [lastMessage, clear]);

	// Fetch AI suggestions on streaming → idle transition
	useEffect(() => {
		const prevStatus = prevStatusRef.current;
		prevStatusRef.current = status;

		if (prevStatus === "streaming" && status === "ready" && isEnabled) {
			const controller = new AbortController();
			abortRef.current?.abort();
			abortRef.current = controller;

			setIsLoading(true);

			fetch(suggestionsUrl, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
					...userHeaders,
				},
				body: JSON.stringify({ messages, count }),
				signal: controller.signal,
			})
				.then((res) => {
					if (!res.ok) throw new Error(`Suggestions API error: ${res.status}`);
					return res.json();
				})
				.then((data) => {
					if (!controller.signal.aborted) {
						setSuggestions(data.suggestions ?? []);
					}
				})
				.catch((err) => {
					if (err.name !== "AbortError") {
						console.warn("[WaniWani] Failed to fetch suggestions:", err);
					}
				})
				.finally(() => {
					if (!controller.signal.aborted) {
						setIsLoading(false);
					}
				});
		}
	}, [status, isEnabled, suggestionsUrl, apiKey, messages, count, userHeaders]);

	// Cleanup on unmount
	useEffect(() => {
		return () => {
			abortRef.current?.abort();
		};
	}, []);

	return { suggestions, isLoading, clear };
}
