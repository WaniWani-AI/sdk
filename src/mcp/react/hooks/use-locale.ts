"use client";

import { useWidgetClient } from "./use-widget";

/**
 * Get the current locale.
 * Works on both OpenAI widgets and MCP Apps.
 *
 * @returns The current locale string (e.g., "en-US")
 */
export function useLocale(): string {
	return useWidgetClient("locale");
}
