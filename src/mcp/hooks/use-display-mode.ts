"use client";

import type { DisplayMode } from "./@types";
import { useWidgetClient } from "./use-widget";

/**
 * Get the current display mode.
 * Works on both OpenAI widgets and MCP Apps.
 *
 * @returns The current display mode ("pip" | "inline" | "fullscreen")
 */
export function useDisplayMode(): DisplayMode {
	return useWidgetClient("displayMode");
}
