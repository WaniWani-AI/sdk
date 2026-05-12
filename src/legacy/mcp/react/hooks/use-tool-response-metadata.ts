"use client";

import type { UnknownObject } from "./@types";
import { useWidgetClient } from "./use-widget";

/**
 * Get tool response metadata.
 * Contains host/tool metadata (for example identifiers like
 * `openai/widgetSessionId` and custom tool `_meta` fields).
 * Returns null when the host does not provide metadata.
 *
 * @deprecated Legacy MCP-widget-in-host stack. Preserved for back-compat; will move to
 *   `@waniwani/sdk/legacy/react` in a future minor release.
 * @returns The tool response metadata object or null if not available
 */
export function useToolResponseMetadata(): UnknownObject | null {
	return useWidgetClient("toolResponseMetadata");
}
