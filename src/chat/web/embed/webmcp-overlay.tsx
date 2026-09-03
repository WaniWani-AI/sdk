"use client";

import { useCallback, useEffect, useState } from "react";
import { autoHeightFromMeta } from "../../../shared/view-uri";
import type { WebMcpWidgetPayload } from "../../../webmcp";
import { McpAppFrame } from "../components/mcp-app-frame";
import { cn } from "../lib/utils";

/**
 * Renders a flow's widget step on the page while a browsing agent talks the
 * visitor through it.
 *
 * The agent lives outside the page and WebMCP carries tools only, so a widget
 * step can never render in the agent's own window. It renders here. The bridge
 * resolves the step server-side and hands over everything the view needs; this
 * mounts it and speaks the host half of the MCP Apps protocol, using the same
 * component the chat uses for widgets in a message bubble.
 *
 * A sibling of the chat rather than a part of it. A widget step arrives whether
 * or not the panel is open, and the visitor is looking at the page, because the
 * conversation is happening somewhere else entirely.
 *
 * The view is byte-identical to the one a connector host renders. Neither side
 * knows which host it woke up in.
 */

/**
 * Width the panel is designed for, and the width the view is handed.
 *
 * 672px is not arbitrary. Two-column widget layouts sit behind Tailwind's `sm:`
 * breakpoint at 640px, so a narrower panel is not a smaller version of the same
 * widget, it is the mobile layout with the columns stacked.
 */
const PANEL_WIDTH = 672;

/** Leaves the panel clear of the viewport edges when a view asks for more room than there is. */
const VIEWPORT_MARGIN = 32;

/**
 * `McpAppFrame` is used exactly as the chat uses it, with no new props.
 *
 * Three things would be worth telling it on this surface, and none of them are
 * worth touching a component every customer's chat renders:
 *
 * - It advertises a `message` capability in its handshake, which is how a view
 *   pushes a follow-up into the conversation. There is no channel back to a
 *   browsing agent, so a view that uses it is ignored. The panel's own content
 *   still works; only the agent's narration is lost.
 * - Its `hostInfo` says "Waniwani Chat". A view reading it is told the wrong
 *   host, and nothing in ours reads it.
 * - It clamps its own height. The panel below sets `maxHeight` and scrolls, so
 *   an oversized view is contained here rather than there.
 *
 * Each becomes worth doing once this surface has run in front of real traffic
 * and one of them has actually cost something.
 */

export type WebMcpOverlayProps = {
	/** The step to show, or `null` for nothing. */
	widget: WebMcpWidgetPayload | null;
	/** The tools endpoint, so a view's own `tools/call` can be proxied. */
	toolsEndpoint: string;
	/** Auth for that endpoint, matching what the bridge sends. */
	headers?: Record<string, string>;
	/**
	 * Where view HTML is fetched from, resolved from the token the same way the
	 * chat's own widget iframes resolve theirs.
	 */
	resourceEndpoint: string;
	/** Raised when the view says it is finished, and on Escape for a preview. */
	onClose: () => void;
	isDark?: boolean;
};

export function WebMcpOverlay({
	widget,
	toolsEndpoint,
	resourceEndpoint,
	headers,
	onClose,
	isDark = false,
}: WebMcpOverlayProps) {
	const [viewport, setViewport] = useState<{
		width: number;
		height: number;
	} | null>(null);

	// Clamping needs the viewport, and reading it during render would differ
	// between a server pass and the client one.
	useEffect(() => {
		const read = () =>
			setViewport({ width: window.innerWidth, height: window.innerHeight });
		read();
		window.addEventListener("resize", read);
		return () => window.removeEventListener("resize", read);
	}, []);

	// A real widget step is a flow waiting on the visitor, and closing it strands
	// the agent mid-conversation with no way to reopen. A preview is something
	// someone opened to look at, so it gets a way out.
	const dismissable = widget?.preview === true;

	useEffect(() => {
		if (!widget || !dismissable) {
			return;
		}
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				onClose();
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [widget, dismissable, onClose]);

	useEffect(() => {
		if (!widget) {
			return;
		}
		const previous = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		return () => {
			document.body.style.overflow = previous;
		};
	}, [widget]);

	const callTool = useCallback(
		async (params: { name: string; arguments: Record<string, unknown> }) => {
			const response = await fetch(toolsEndpoint, {
				method: "POST",
				headers: { "content-type": "application/json", ...headers },
				body: JSON.stringify({ action: "call", ...params }),
			});
			if (!response.ok) {
				throw new Error(`webmcp tool call failed: ${response.status}`);
			}
			return (await response.json()) as {
				content?: Array<{ type: string; text?: string }>;
				structuredContent?: Record<string, unknown>;
				_meta?: Record<string, unknown>;
			};
		},
		[toolsEndpoint, headers],
	);

	if (!widget) {
		return null;
	}

	const width = viewport
		? Math.min(PANEL_WIDTH, viewport.width - VIEWPORT_MARGIN)
		: PANEL_WIDTH;
	const maxHeight = viewport ? viewport.height - VIEWPORT_MARGIN : undefined;

	return (
		<div
			role="dialog"
			aria-modal="true"
			aria-label="Waniwani"
			// `dark` here and not on an ancestor: this shadow root is a sibling of
			// the chat's, so it inherits none of the chat root's theming and has to
			// switch the tokens itself.
			//
			// The z-index is arbitrary because the scale has no rung this high, and
			// it has to clear whatever the host page stacks.
			className={cn(
				"ww:fixed ww:inset-0 ww:z-[2147483000] ww:flex ww:items-center ww:justify-center ww:bg-black/45 ww:backdrop-blur-md",
				isDark && "dark",
			)}
		>
			{/* A real button rather than a click handler on the backdrop div, so
			    dismissing works from the keyboard and announces itself. Absent
			    entirely for a real widget step, which has no way out by design. */}
			{dismissable && (
				<button
					type="button"
					aria-label="Close"
					onClick={onClose}
					className="ww:absolute ww:inset-0 ww:h-full ww:w-full ww:cursor-pointer ww:border-none ww:bg-transparent ww:p-0"
				/>
			)}
			<div
				className="ww:relative ww:overflow-auto ww:rounded-2xl ww:bg-background ww:shadow-2xl"
				// Measured, not themeable: `width` tracks the viewport and `maxHeight`
				// is whatever is left of it. Neither has a utility class.
				style={{ width, maxHeight }}
			>
				<McpAppFrame
					// Remount on a new view so the frame's handshake, retry counter and
					// size latch all start clean rather than carrying the last widget's.
					key={`${resourceEndpoint}|${widget.viewUri}`}
					resourceUri={widget.viewUri}
					resourceEndpoint={resourceEndpoint}
					toolInput={widget.data}
					toolResult={widget.result}
					autoHeight={autoHeightFromMeta(widget.result._meta)}
					isDark={isDark}
					onCallTool={callTool}
					onOpenLink={(url) => window.open(url, "_blank", "noopener")}
				/>
			</div>
		</div>
	);
}
