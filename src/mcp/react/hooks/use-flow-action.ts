"use client";

import { useCallback, useRef, useState } from "react";
import { detectPlatform } from "../widgets/platform";
import type { ToolCallResult } from "../widgets/widget-client";
import { useToolOutput } from "./use-tool-output";
import { useWidgetClient } from "./use-widget";

// ── Types ────────────────────────────────────────────────────

/** Flow metadata embedded in structuredContent.__flow */
type FlowMeta = {
	flowId: string;
	step: string;
	state: Record<string, unknown>;
};

/** Parsed response text from a flow tool call */
type FlowResponseText = {
	status: "widget" | "interrupt" | "complete" | "error";
	step?: string;
	widgetId?: string;
	description?: string;
	state?: Record<string, unknown>;
	question?: string;
	error?: string;
};

/** Return type of the useFlowAction hook */
export type FlowActionResult<T> = {
	/** Current widget data. Initially from useToolOutput, then updated inline on same-widget transitions. */
	data: T | null;
	/** Advance the flow with the user's answer. `value` is used for callTool (option.id), `followUpText` for sendFollowUp fallback (option.label). */
	advance: (value: string, followUpText?: string) => void;
	/** True while a callTool request is in flight. */
	isAdvancing: boolean;
};

// ── Helpers ──────────────────────────────────────────────────

function extractFlowMeta(
	data: Record<string, unknown> | null,
): FlowMeta | null {
	if (!data?.__flow) return null;
	const flow = data.__flow as FlowMeta;
	if (!flow.flowId || !flow.step || !flow.state) return null;
	return flow;
}

function parseResponseText(result: ToolCallResult): FlowResponseText | null {
	const textEntry = result.content?.find((c) => c.type === "text" && c.text);
	if (!textEntry?.text) return null;
	try {
		return JSON.parse(textEntry.text) as FlowResponseText;
	} catch {
		return null;
	}
}

function buildFallbackMessage(parsed: FlowResponseText): string {
	if (parsed.status === "interrupt" && parsed.question) {
		return parsed.question;
	}
	if (parsed.status === "complete") {
		return "Flow completed.";
	}
	if (parsed.status === "error" && parsed.error) {
		return `Error: ${parsed.error}`;
	}
	if (parsed.status === "widget" && parsed.step) {
		return `The user selected an option. Continue the flow from step "${parsed.step}".`;
	}
	return "Continue the flow.";
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
 * ```
 */
export function useFlowAction<T extends Record<string, unknown>>(
	resourceId: string,
): FlowActionResult<T> {
	const client = useWidgetClient();
	const initialData = useToolOutput<T & { __flow?: FlowMeta }>();

	// Local data state for inline transitions. When null, we use initialData.
	const [localData, setLocalData] = useState<T | null>(null);
	const [isAdvancing, setIsAdvancing] = useState(false);

	// Track __flow metadata across inline transitions via ref (no re-renders needed).
	const flowMetaRef = useRef<FlowMeta | null>(null);

	// Keep flowMetaRef in sync with the latest data source.
	const currentData =
		localData ?? (initialData as Record<string, unknown> | null);
	const currentFlowMeta = currentData ? extractFlowMeta(currentData) : null;
	if (currentFlowMeta) {
		flowMetaRef.current = currentFlowMeta;
	}

	const advance = useCallback(
		(value: string, followUpText?: string) => {
			const platform = detectPlatform();
			const displayText = followUpText ?? value;

			// OpenAI: sendFollowUp works great, use it directly
			if (platform === "openai") {
				client.sendFollowUp(displayText);
				return;
			}

			// MCP Apps: call the flow tool directly to bypass the composer
			const flowMeta = flowMetaRef.current;
			if (!flowMeta) {
				client.sendFollowUp(displayText);
				return;
			}

			setIsAdvancing(true);

			client
				.callTool(flowMeta.flowId, {
					action: "widget_result",
					step: flowMeta.step,
					state: flowMeta.state,
					answer: value,
				})
				.then((result: ToolCallResult) => {
					const parsed = parseResponseText(result);

					if (!parsed) {
						client.sendFollowUp(displayText);
						return;
					}

					// Same-widget inline transition
					if (
						parsed.status === "widget" &&
						parsed.widgetId === resourceId &&
						result.structuredContent
					) {
						const newFlowMeta = extractFlowMeta(result.structuredContent);
						if (newFlowMeta) {
							flowMetaRef.current = newFlowMeta;
						}
						const { __flow, ...widgetData } = result.structuredContent;
						setLocalData(widgetData as T);
						return;
					}

					// All other cases: fall back to sendFollowUp
					const message = buildFallbackMessage(parsed);
					client.sendFollowUp(message);
				})
				.catch((err: unknown) => {
					console.error("useFlowAction: callTool failed, falling back", err);
					client.sendFollowUp(displayText);
				})
				.finally(() => {
					setIsAdvancing(false);
				});
		},
		[client, resourceId],
	);

	const effectiveData: T | null = localData ?? (initialData as T | null);

	return { data: effectiveData, advance, isAdvancing };
}
