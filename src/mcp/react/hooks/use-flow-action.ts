"use client";

import { useToolOutput } from "./use-tool-output";

// ── Types ────────────────────────────────────────────────────

type FlowStatus = "widget" | "interrupt" | "complete" | "error";

/** Return type of the useFlowAction hook */
export type FlowActionResult<T> = {
	/** Current flow status — null when structuredContent is absent or not a flow response. */
	status: FlowStatus | null;
	/** Widget identifier — only set when status is "widget". */
	widgetId: string | null;
	/** Widget data (structuredContent minus internal __ fields). */
	data: T | null;
};

// ── Helpers ──────────────────────────────────────────────────

function parseFlowOutput<T extends Record<string, unknown>>(
	raw: Record<string, unknown> | null,
): FlowActionResult<T> {
	if (!raw || !("__status" in raw)) {
		return { status: null, widgetId: null, data: null };
	}

	const { __status, __widgetId, ...rest } = raw;

	return {
		status: __status as FlowStatus,
		widgetId: (__widgetId as string) ?? null,
		data: (Object.keys(rest).length > 0 ? rest : null) as T | null,
	};
}

// ── Hook ─────────────────────────────────────────────────────

/**
 * Hook for reading flow widget data from structuredContent.
 *
 * Extracts `__status` and `__widgetId` from the flow's structuredContent,
 * returning clean data for the widget component.
 *
 * @example
 * ```tsx
 * const { status, widgetId, data } = useFlowAction<MyData>();
 *
 * if (status !== "widget" || !widgetId) return null;
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
	const raw = useToolOutput<Record<string, unknown>>();
	return parseFlowOutput<T>(raw);
}
