"use client";

import { useCallback } from "react";
import {
	hasModelContext,
	type ModelContextUpdate,
} from "../../../shared/model-context";
import { useWidgetClient } from "./use-widget";

export interface SendFollowUpOptions {
	modelContext?: ModelContextUpdate | null;
}

/**
 * Get a function to send follow-up messages to the AI.
 * Works on both OpenAI widgets and MCP Apps.
 *
 * @returns A function that sends a follow-up message
 */
export function useSendFollowUp(): (
	prompt: string,
	options?: SendFollowUpOptions,
) => void {
	const client = useWidgetClient();
	return useCallback(
		(prompt: string, options?: SendFollowUpOptions) => {
			void (async () => {
				if (hasModelContext(options?.modelContext)) {
					await Promise.resolve(
						client.updateModelContext(options.modelContext),
					);
				}
				await Promise.resolve(client.sendFollowUp(prompt));
			})().catch((error) => {
				console.error("Failed to send follow-up message:", error);
			});
		},
		[client],
	);
}
