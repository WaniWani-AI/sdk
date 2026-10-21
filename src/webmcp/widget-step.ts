/**
 * Widget steps on the WebMCP surface.
 *
 * In a chat host a flow's widget step is a two-call dance: the flow answers
 * `status: "widget"` naming a display tool, the model calls that tool, and the
 * host renders the `ui://` template it points at. None of that survives the
 * trip to a browsing agent. There is no widget host in the agent's window, the
 * display tool is not advertised on this surface, and the round trip would cost
 * a turn for a render nobody performs.
 *
 * So the step is resolved before the agent ever sees it. The server calls the
 * display tool, finds its view, and hands the page everything it needs to mount
 * the widget itself. The agent gets prose that never names a display tool. The
 * visitor gets the calendar on the page they are already looking at.
 */

import type { FlowWidgetContent } from "../mcp/server/flows/@types";
import type { WebMcpCallResult } from "./@types";

export type WidgetStep = {
	/**
	 * The flow's own response, carried whole.
	 *
	 * Typed as the engine's own `FlowWidgetContent` rather than a local shape, so
	 * a field added to a widget step reaches this file as a type change instead
	 * of being silently dropped. That has already happened once: `intro` was
	 * added to the payload and the surface that hand-rolled this parse kept
	 * working only because it spread the rest through.
	 */
	payload: FlowWidgetContent;
	tool: string;
	data: Record<string, unknown>;
	interactive: boolean;
};

/**
 * A flow's widget step, or `null` for every other tool result.
 *
 * Flow tools answer with a single JSON text block, so anything that does not
 * parse as JSON with `status: "widget"` and a `tool` to call belongs to someone
 * else and passes through untouched. That includes ordinary tools, which is
 * most of them.
 */
export function readWidgetStep(result: WebMcpCallResult): WidgetStep | null {
	const first = result.content?.[0];
	if (!first || first.type !== "text" || typeof first.text !== "string") {
		return null;
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(first.text);
	} catch {
		return null;
	}

	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		return null;
	}

	const payload = parsed as Record<string, unknown>;
	if (payload.status !== "widget" || typeof payload.tool !== "string") {
		return null;
	}

	const data =
		payload.data &&
		typeof payload.data === "object" &&
		!Array.isArray(payload.data)
			? (payload.data as Record<string, unknown>)
			: {};

	return {
		payload: payload as FlowWidgetContent,
		tool: payload.tool,
		data,
		// The protocol treats an unset `interactive` as display-only, and so does
		// this. Telling the agent to wait for an interaction that never comes
		// strands the conversation; continuing early only costs a turn.
		interactive: payload.interactive === true,
	};
}

const WAIT_INSTRUCTIONS =
	'The interface for this step is now open in front of the user, on the page. There is no display tool to call on this surface, so do not try. Say one short sentence about what is on screen, then stop and wait for the user to tell you what they did. When they do, call this flow again with action "continue".';

const SHOWN_INSTRUCTIONS =
	'The interface for this step is now open in front of the user, on the page. There is no display tool to call on this surface, so do not try. Summarise `data` in one short sentence, then call this flow again with action "continue".';

const UNAVAILABLE_INSTRUCTIONS =
	"The interface for this step could not be opened on the page. Carry the step in words instead: tell the user everything in `data` yourself, then proceed as you otherwise would.";

/** The status a rewritten widget step reports in place of `"widget"`. */
export type WidgetStepStatus = "widget_shown" | "widget_unavailable";

/**
 * The step as the agent should read it.
 *
 * Built by editing the flow's own payload rather than composing a new object,
 * so the fields the protocol requires the agent to echo back survive. Dropping
 * `sessionId` here breaks the flow several turns later, which is the worst kind
 * of bug to go looking for.
 *
 * `tool` and `description` are the two that must not survive. Both name a
 * display tool the agent cannot call, and leaving either in place is an
 * instruction to attempt it.
 */
export function rewriteForAgent(
	step: WidgetStep,
	rendered: boolean,
): Record<string, unknown> & { status: WidgetStepStatus } {
	const { tool: _tool, description: _description, ...rest } = step.payload;
	return {
		...rest,
		status: rendered ? "widget_shown" : "widget_unavailable",
		instructions: rendered
			? step.interactive
				? WAIT_INSTRUCTIONS
				: SHOWN_INSTRUCTIONS
			: UNAVAILABLE_INSTRUCTIONS,
	};
}
