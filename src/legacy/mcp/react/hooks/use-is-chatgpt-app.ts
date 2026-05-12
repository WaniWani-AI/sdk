"use client";

import { useSyncExternalStore } from "react";

/**
 * Check if running in ChatGPT app (OpenAI-only).
 * Returns false on MCP Apps.
 *
 * @deprecated Legacy MCP-widget-in-host stack. Preserved for back-compat; will move to
 *   `@waniwani/sdk/legacy/react` in a future minor release.
 * @returns Whether the widget is running in ChatGPT app
 */
export function useIsChatGptApp(): boolean {
	return useSyncExternalStore(
		() => () => {},
		() => {
			if (typeof window === "undefined") {
				return false;
			}
			// biome-ignore lint/suspicious/noExplicitAny: __isChatGptApp is injected by ChatGPT
			return (window as any).__isChatGptApp === true;
		},
		() => false,
	);
}
