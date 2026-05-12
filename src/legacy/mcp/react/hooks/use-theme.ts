"use client";

import type { Theme } from "./@types";
import { useWidgetClient } from "./use-widget";

/**
 * Get the current theme.
 * Works on both OpenAI widgets and MCP Apps.
 *
 * @deprecated Legacy MCP-widget-in-host stack. Preserved for back-compat; will move to
 *   `@waniwani/sdk/legacy/react` in a future minor release.
 * @returns The current theme ("light" | "dark")
 */
export function useTheme(): Theme {
	return useWidgetClient("theme");
}
