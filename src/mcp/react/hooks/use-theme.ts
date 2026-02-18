"use client";

import type { Theme } from "./@types";
import { useWidgetClient } from "./use-widget";

/**
 * Get the current theme.
 * Works on both OpenAI widgets and MCP Apps.
 *
 * @returns The current theme ("light" | "dark")
 */
export function useTheme(): Theme {
	return useWidgetClient("theme");
}
