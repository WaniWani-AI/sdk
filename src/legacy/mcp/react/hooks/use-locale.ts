"use client";

import { useWidgetClient } from "./use-widget";

/**
 * Get the current locale.
 * Works on both OpenAI widgets and MCP Apps.
 *
 * @deprecated Legacy MCP-widget-in-host stack. Preserved for back-compat; will move to
 *   `@waniwani/sdk/legacy/react` in a future minor release.
 * @returns The current locale string (e.g., "en-US")
 */
export function useLocale(): string {
	return useWidgetClient("locale");
}
