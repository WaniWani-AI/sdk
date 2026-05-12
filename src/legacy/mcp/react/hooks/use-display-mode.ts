"use client";

import type { DisplayMode } from "./@types";
import { useWidgetClient } from "./use-widget";

/**
 * Get the current display mode.
 * Works on both OpenAI widgets and MCP Apps.
 *
 * @deprecated Legacy MCP-widget-in-host stack. Preserved for back-compat; will move to
 *   `@waniwani/sdk/legacy/react` in a future minor release.
 * @returns The current display mode ("pip" | "inline" | "fullscreen")
 */
export function useDisplayMode(): DisplayMode {
	return useWidgetClient("displayMode");
}
