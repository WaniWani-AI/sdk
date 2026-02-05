"use client";

import { useCallback } from "react";
import { useWidgetClient } from "./use-widget";

/**
 * Get a function to send follow-up messages to the AI.
 * Works on both OpenAI widgets and MCP Apps.
 *
 * @returns A function that sends a follow-up message
 */
export function useSendFollowUp(): (prompt: string) => void {
	const client = useWidgetClient();
	return useCallback((prompt: string) => client.sendFollowUp(prompt), [client]);
}
