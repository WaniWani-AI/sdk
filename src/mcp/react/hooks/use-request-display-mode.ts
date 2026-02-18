"use client";

import { useCallback } from "react";
import type { DisplayMode } from "./@types";
import { useWidgetClient } from "./use-widget";

/**
 * Get a function to request display mode changes.
 * On MCP Apps, this may be a no-op depending on host support.
 *
 * @returns A function to request a specific display mode
 */
export function useRequestDisplayMode(): (
	mode: DisplayMode,
) => Promise<DisplayMode> {
	const client = useWidgetClient();
	return useCallback(
		(mode: DisplayMode) => client.requestDisplayMode(mode),
		[client],
	);
}
