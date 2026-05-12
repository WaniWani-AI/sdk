"use client";

import { useCallback } from "react";
import { useWidgetClient } from "./use-widget";

/**
 * Get a function to open external URLs.
 * Works on both OpenAI widgets and MCP Apps.
 *
 * @deprecated Legacy MCP-widget-in-host stack. Preserved for back-compat; will move to
 *   `@waniwani/sdk/legacy/react` in a future minor release.
 * @returns A function that opens external URLs
 */
export function useOpenExternal(): (url: string) => void {
	const client = useWidgetClient();
	return useCallback((url: string) => client.openExternal(url), [client]);
}
