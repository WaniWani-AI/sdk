"use client";

import type { SafeArea } from "./@types";
import { useWidgetClient } from "./use-widget";

/**
 * Get safe area insets (OpenAI-only).
 * Useful for ensuring UI elements don't get hidden behind the chat input.
 * Returns null on MCP Apps.
 *
 * @returns The safe area insets, or null if not available
 */
export function useSafeArea(): SafeArea | null {
	return useWidgetClient("safeArea");
}
