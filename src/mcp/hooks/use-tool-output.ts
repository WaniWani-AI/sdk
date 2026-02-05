"use client";

import { useWidgetClient } from "./use-widget";

/**
 * Get the tool output (structured content returned by the tool handler).
 * Works on both OpenAI widgets and MCP Apps.
 *
 * @returns The tool output or null
 */
export function useToolOutput<T extends Record<string, unknown>>(): T | null {
	return useWidgetClient("toolOutput") as T | null;
}
