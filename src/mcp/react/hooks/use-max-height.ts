"use client";

import { useWidgetClient } from "./use-widget";

/**
 * Get the maximum height available for the widget (OpenAI-only).
 * Useful for responsive layouts that need to adapt to container constraints.
 * Returns null on MCP Apps.
 *
 * @returns The maximum height in pixels, or null if not available
 */
export function useMaxHeight(): number | null {
	return useWidgetClient("maxHeight");
}
