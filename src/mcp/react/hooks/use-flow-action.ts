"use client";

import { useCallback, useRef, useState } from "react";
import { detectPlatform } from "../widgets/platform";
import type { ToolCallResult } from "../widgets/widget-client";
import { useToolOutput } from "./use-tool-output";
import { useToolResponseMetadata } from "./use-tool-response-metadata";
import { useWidgetClient } from "./use-widget";

// ── Types ────────────────────────────────────────────────────

/** Flow metadata embedded in response _meta.flow */
type FlowMeta = {
	flowId: string;
	step: string;
	state: Record<string, unknown>;
	field?: string;
	widgetId?: string;
};

/** Parsed response text from a flow tool call */
type FlowResponseText = {
	status: "widget" | "interrupt" | "complete" | "error";
	description?: string;
	question?: string;
	error?: string;
};

/** Return type of the useFlowAction hook */
export type FlowActionResult<T> = {
	/** Current widget data. Initially from useToolOutput, then updated inline on same-widget transitions. */
	data: T | null;
	/** Advance the flow with the user's answer. Optionally include `stateUpdates` to update any flow field at this step. */
	advance: (
		value: string,
		followUpText?: string,
		stateUpdates?: Record<string, unknown>,
	) => void;
	/** True while a callTool request is in flight. */
	isAdvancing: boolean;
};

// ── Helpers ──────────────────────────────────────────────────

function extractFlowMeta(
	meta: Record<string, unknown> | null | undefined,
): FlowMeta | null {
	if (!meta?.flow) return null;
	const flow = meta.flow as FlowMeta;
	if (!flow.flowId || !flow.step || !flow.state) return null;
	return flow;
}

function parseResponseText(result: ToolCallResult): FlowResponseText | null {
	const text = (result.content ?? [])
		.filter((c) => c.type === "text")
		.map((c) => c.text)
		.join("")
		.trim();
	if (!text) return null;
	try {
		return JSON.parse(text) as FlowResponseText;
	} catch {
		return null;
	}
}

// ── Hook ─────────────────────────────────────────────────────

/**
 * Hook for advancing a flow directly from a widget, bypassing the chat
 * composer on MCP Apps (Claude). On OpenAI, delegates to sendFollowUp.
 *
 * Replaces the combination of `useToolOutput` + `useSendFollowUp` in flow widgets.
 *
 * @param resourceId - The resource ID of the current widget (e.g., "option_picker").
 *   Used to detect same-widget transitions for inline re-rendering.
 *
 * @example
 * ```tsx
 * const { data, advance, isAdvancing } = useFlowAction<OptionPickerProps>("option_picker");
 * // On click:
 * advance(option.id, option.label);
 * // With extra cross-field updates:
 * // advance(option.id, option.label, { role: "CTO" });
 * ```
 */
export function useFlowAction<T extends Record<string, unknown>>(
	resourceId: string,
): FlowActionResult<T> {
	const client = useWidgetClient();
	const initialData = useToolOutput<T>();
	const initialMeta = useToolResponseMetadata();

	// Local data state for inline transitions. When null, we use initialData.
	const [localData, setLocalData] = useState<T | null>(null);
	const [localMeta, setLocalMeta] = useState<Record<string, unknown> | null>(
		null,
	);
	const [isAdvancing, setIsAdvancing] = useState(false);

	// Track flow metadata across inline transitions via ref (no re-renders needed).
	const flowMetaRef = useRef<FlowMeta | null>(null);

	// Keep flowMetaRef in sync with the latest metadata source.
	const currentMeta =
		localMeta ?? (initialMeta as Record<string, unknown> | null);
	const currentFlowMeta = currentMeta ? extractFlowMeta(currentMeta) : null;
	if (currentFlowMeta) {
		flowMetaRef.current = currentFlowMeta;
	}

	const advance = useCallback(
		async (
			value: string,
			followUpText?: string,
			stateUpdates?: Record<string, unknown>,
		) => {
			const platform = detectPlatform();

			// OpenAI: sendFollowUp works great, use it directly
			if (platform === "openai") {
				client.sendFollowUp(followUpText ?? value);
				return;
			}

			// MCP Apps: call the flow tool directly via callTool.
			const flowMeta = flowMetaRef.current;

			if (!flowMeta) return;

			setIsAdvancing(true);
			try {
				const result = await client.callTool(flowMeta.flowId, {
					action: "widget_result",
					_meta: {
						flow: {
							step: flowMeta.step,
							state: flowMeta.state,
						},
					},
					answer: value,
					...(stateUpdates ? { stateUpdates } : {}),
				});

				const parsed = parseResponseText(result);
				if (!parsed) return;

				// Same-widget inline transition: widgetId is now in _meta.flow
				if (parsed.status === "widget" && result.structuredContent) {
					const newFlowMeta = extractFlowMeta(
						result._meta as Record<string, unknown> | undefined,
					);
					if (newFlowMeta?.widgetId === resourceId) {
						flowMetaRef.current = newFlowMeta;
						setLocalData(result.structuredContent as T);
						if (result._meta) {
							setLocalMeta(result._meta as Record<string, unknown>);
						}
					}
				}
			} catch (err) {
				console.error("useFlowAction: callTool failed", err);
			} finally {
				setIsAdvancing(false);
			}
		},
		[client, resourceId],
	);

	const effectiveData: T | null = localData ?? (initialData as T | null);

	return { data: effectiveData, advance, isAdvancing };
}
