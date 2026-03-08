"use client";

import { useToolOutput } from "./use-tool-output";

// ── Types ────────────────────────────────────────────────────

/** Return type of the useFlowAction hook */
export type FlowActionResult<T> = {
	/** Sub-widget identifier — only set in container mode (from __widgetId in structuredContent). */
	widgetId: string | null;
	/** Current widget data. */
	data: T | null;
};

// ── Helpers ──────────────────────────────────────────────────

function extractWidgetId<T extends Record<string, unknown>>(
	data: T | null,
): { widgetId: string | null; cleanData: T | null } {
	if (!data || !("__widgetId" in data)) {
		return { widgetId: null, cleanData: data };
	}
	const { __widgetId, ...rest } = data;
	return { widgetId: __widgetId as string, cleanData: rest as T };
}

// ── Hook ─────────────────────────────────────────────────────

/**
 * Hook for reading flow widget data. Extracts `__widgetId` from
 * structuredContent when using the container widget pattern.
 *
 * @example
 * ```tsx
 * const { widgetId, data } = useFlowAction<MyData>();
 * if (!widgetId || !data) return null;
 *
 * switch (widgetId) {
 *   case "pricing_table": return <PricingTable {...data} />;
 *   default: return null;
 * }
 * ```
 */
export function useFlowAction<
	T extends Record<string, unknown>,
>(): FlowActionResult<T> {
	const initialData = useToolOutput<T>();
	const { widgetId, cleanData } = extractWidgetId(initialData as T | null);

	return { widgetId, data: cleanData };
}
