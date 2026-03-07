"use client";

import { useCallback, useRef, useState } from "react";
import { detectPlatform } from "../widgets/platform";
import type { ToolCallResult } from "../widgets/widget-client";
import { useToolOutput } from "./use-tool-output";
import { useWidgetClient } from "./use-widget";

// ── Types ────────────────────────────────────────────────────

/** Flow routing info extracted from the text content payload */
type FlowRouting = {
	flowId: string;
	flowToken: string;
};

/** Parsed response text from a flow tool call */
type FlowResponseText = {
	status: "widget" | "interrupt" | "complete" | "error";
	description?: string;
	question?: string;
	error?: string;
	flowToken?: string;
	flowId?: string;
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

function extractFlowRouting(result: ToolCallResult): FlowRouting | null {
	const parsed = parseResponseText(result);
	if (!parsed?.flowToken || !parsed?.flowId) return null;
	return { flowId: parsed.flowId, flowToken: parsed.flowToken };
}

function decodeFlowTokenSafe(token: string): { widgetId?: string } | null {
	try {
		return JSON.parse(
			typeof Buffer !== "undefined"
				? Buffer.from(token, "base64").toString("utf-8")
				: atob(token),
		) as { widgetId?: string };
	} catch {
		return null;
	}
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

	// Local data state for inline transitions. When null, we use initialData.
	const [localData, setLocalData] = useState<T | null>(null);
	const [isAdvancing, setIsAdvancing] = useState(false);

	// Track flow routing across inline transitions via ref (no re-renders needed).
	const flowRoutingRef = useRef<FlowRouting | null>(null);

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
			const routing = flowRoutingRef.current;

			if (!routing) return;

			setIsAdvancing(true);
			try {
				const result = await client.callTool(routing.flowId, {
					action: "continue",
					flowToken: routing.flowToken,
					stateUpdates: {
						...(stateUpdates ?? {}),
					},
				});

				const parsed = parseResponseText(result);
				if (!parsed) return;

				// Update routing from new response
				const newRouting = extractFlowRouting(result);
				if (newRouting) {
					flowRoutingRef.current = newRouting;
				}

				// Same-widget inline transition: decode token to check widgetId
				if (parsed.status === "widget" && result.structuredContent) {
					const tokenData = newRouting?.flowToken
						? decodeFlowTokenSafe(newRouting.flowToken)
						: null;
					if (!tokenData?.widgetId || tokenData.widgetId === resourceId) {
						setLocalData(result.structuredContent as T);
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
