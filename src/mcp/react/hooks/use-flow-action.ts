"use client";

import { useToolOutput } from "./use-tool-output";

// ── Types ────────────────────────────────────────────────────

/** Return type of the useFlowAction hook */
export type FlowActionResult<T> = {
	/** Current widget data from structuredContent. */
	data: T | null;
};

// ── Hook ─────────────────────────────────────────────────────

/**
 * Hook for reading flow widget data from structuredContent.
 * Lightweight wrapper over `useToolOutput` — will be extended
 * with flow-specific features in the future.
 *
 * @example
 * ```tsx
 * const { data } = useFlowAction<{ plans: string[] }>();
 * if (!data) return null;
 * return <PricingTable plans={data.plans} />;
 * ```
 */
export function useFlowAction<
	T extends Record<string, unknown>,
>(): FlowActionResult<T> {
	const data = useToolOutput<T>();
	return { data };
}
