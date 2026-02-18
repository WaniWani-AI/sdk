"use client";

import type { UnknownObject } from "./@types";
import { useWidgetClient } from "./use-widget";

/**
 * Get tool response metadata (OpenAI-only).
 * Contains identifiers like `openai/widgetSessionId` for correlating
 * multiple tool calls or logs for the same widget instance.
 * Returns null on MCP Apps.
 *
 * @returns The tool response metadata object or null if not available
 */
export function useToolResponseMetadata(): UnknownObject | null {
	return useWidgetClient("toolResponseMetadata");
}
