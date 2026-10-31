"use client";

// ============================================================================
// Forwards the widget-event suggestion signals to the canonical ingest.
//
// Every mount point that owns a `WidgetEventEmitter` mounts this, so a pill
// impression is recorded the same way on every surface. Riding the widget
// event stream rather than the render sites keeps one signal per interaction:
// the host page's `onEvent` subscriber and our own ingest see the same event.
// ============================================================================

import { useEffect, useRef } from "react";
import type { WidgetEventEmitter, WidgetMode } from "../embed/widget-events";
import type { Suggestion } from "../lib/resolve-suggestions";
import {
	fireSuggestionClick,
	fireSuggestionShown,
	resolveShownSuggestions,
	resolveSuggestionId,
} from "../lib/suggestion-click";

export interface UseSuggestionIngestOptions {
	widgetEvents: WidgetEventEmitter;
	/** Chat API base, e.g. `https://app.waniwani.ai/api/mcp/chat`. */
	api: string | undefined;
	/** Public token (`wwp_...`). Nothing is sent without one. */
	token: string | undefined;
	/** Agent channel ID, when known. */
	channelId?: string;
	/** Channel-specific event source from the resolved `/config`. */
	source?: string;
	/** Embed surface the events happened on. */
	mode: WidgetMode;
	/**
	 * Authored per-page prompts for this URL — the only rung whose pills carry
	 * a stored id, so it is the only list a text can attribute back to.
	 */
	pagePrompts: Suggestion[] | null;
	/**
	 * Read at emit time, not at subscribe time: an impression that precedes the
	 * first exchange has no session id, and the one after it does.
	 */
	getSessionId: () => string | undefined;
}

export function useSuggestionIngest(options: UseSuggestionIngestOptions): void {
	const { widgetEvents, api, token, channelId, source, mode, pagePrompts } =
		options;

	// Held in a ref so a fresh closure on every render never resubscribes.
	const getSessionIdRef = useRef(options.getSessionId);
	getSessionIdRef.current = options.getSessionId;

	useEffect(() => {
		if (!api || !token) {
			return;
		}
		return widgetEvents.subscribe((event) => {
			if (event.name === "suggestion.clicked") {
				const { text, origin, index } = event.properties;
				void fireSuggestionClick({
					api,
					token,
					channelId,
					mode,
					source,
					sessionId: getSessionIdRef.current(),
					promptId: resolveSuggestionId(pagePrompts ?? [], text),
					origin,
					text,
					index,
				});
				return;
			}
			if (event.name === "suggestions.shown") {
				const { texts, origin } = event.properties;
				void fireSuggestionShown({
					api,
					token,
					channelId,
					mode,
					source,
					sessionId: getSessionIdRef.current(),
					prompts: resolveShownSuggestions(pagePrompts ?? [], texts),
					origin,
				});
			}
		});
	}, [widgetEvents, api, token, channelId, source, mode, pagePrompts]);
}
