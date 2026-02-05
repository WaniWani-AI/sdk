"use client";

import { useCallback } from "react";
import type { ToolCallResult } from "../widgets/@utils/widget-client";
import { useWidgetClient } from "./use-widget";

/**
 * Get a function to call other tools.
 * Works on both OpenAI widgets and MCP Apps.
 *
 * @returns A function to call tools with their name and arguments
 */
export function useCallTool(): (
	name: string,
	args: Record<string, unknown>,
) => Promise<ToolCallResult> {
	const client = useWidgetClient();
	return useCallback(
		(name: string, args: Record<string, unknown>) =>
			client.callTool(name, args),
		[client],
	);
}
