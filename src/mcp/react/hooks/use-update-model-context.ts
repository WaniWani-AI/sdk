"use client";

import { useCallback } from "react";
import type { ModelContextUpdate } from "../../../shared/model-context";
import { useWidgetClient } from "./use-widget";

/**
 * Get a function to update hidden model context for the next assistant turn.
 * Uses the MCP Apps `ui/update-model-context` request when available.
 */
export function useUpdateModelContext(): (
	context: ModelContextUpdate,
) => Promise<void> {
	const client = useWidgetClient();

	return useCallback(
		async (context: ModelContextUpdate) => {
			await Promise.resolve(client.updateModelContext(context));
		},
		[client],
	);
}
