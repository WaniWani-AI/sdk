"use client";

import type { ComponentType } from "react";
import { useFlowAction } from "../hooks/use-flow-action";

/** Registry mapping widget IDs to React components. */
export type FlowWidgetRegistry = Record<
	string,
	// biome-ignore lint/suspicious/noExplicitAny: widget data varies per component
	ComponentType<{ data: any }>
>;

/**
 * Factory component that renders the active widget for a flow.
 *
 * Uses `useFlowAction` to read the current flow status and widget ID from
 * structuredContent, then renders the matching component from the registry.
 *
 * Non-widget states (interrupt, complete, error) render an invisible 0-height div
 * so ChatGPT's always-rendered widget frame stays out of the way.
 *
 * @example
 * ```tsx
 * import { WidgetProvider, FlowWidget } from "@waniwani/sdk/mcp/react";
 *
 * const widgets = {
 *   pricing_table: PricingTable,
 *   plan_picker: PlanPicker,
 * };
 *
 * export default function Page() {
 *   return (
 *     <WidgetProvider>
 *       <FlowWidget widgets={widgets} />
 *     </WidgetProvider>
 *   );
 * }
 * ```
 */
export function FlowWidget({ widgets }: { widgets: FlowWidgetRegistry }) {
	const { status, widgetId, data } = useFlowAction();

	if (status !== "widget" || !widgetId) {
		return <div style={{ height: 0, overflow: "hidden" }} />;
	}

	const Widget = widgets[widgetId];
	if (!Widget) {
		return <div style={{ height: 0, overflow: "hidden" }} />;
	}

	return <Widget data={data} />;
}
