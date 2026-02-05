"use client";

import { useSyncExternalStore } from "react";

/**
 * Check if running in ChatGPT app (OpenAI-only).
 * Returns false on MCP Apps.
 *
 * @returns Whether the widget is running in ChatGPT app
 */
export function useIsChatGptApp(): boolean {
	return useSyncExternalStore(
		() => () => {},
		() => {
			if (typeof window === "undefined") return false;
			// biome-ignore lint/suspicious/noExplicitAny: __isChatGptApp is injected by ChatGPT
			return (window as any).__isChatGptApp === true;
		},
		() => false,
	);
}
