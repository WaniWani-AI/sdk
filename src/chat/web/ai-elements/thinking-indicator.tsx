"use client";

import type { ChatStatus, ToolUIPart, UIMessage } from "ai";
import type { HTMLAttributes } from "react";
import { cn } from "../lib/utils";

export type ThinkingPhase = { kind: "thinking" } | null;

function isToolPart(
	part: UIMessage["parts"][number],
): part is UIMessage["parts"][number] & {
	toolCallId: string;
	state: ToolUIPart["state"];
} {
	return typeof (part as { toolCallId?: unknown }).toolCallId === "string";
}

/**
 * Returns `{ kind: "thinking" }` only during dead-air moments where the
 * agent is working but nothing visible is happening:
 *   - waiting for the first stream chunk after submit
 *   - between `tool-output-available` and the next `text-start` / next tool
 *
 * Returns `null` while a tool block or streaming text is already on-screen —
 * those components carry their own activity indicator (pulsing dot / streaming
 * cursor) and the shimmer line would double-signal.
 */
export function derivePhase(
	messages: UIMessage[],
	status: ChatStatus,
): ThinkingPhase {
	if (status !== "submitted" && status !== "streaming") {
		return null;
	}

	const last = messages[messages.length - 1];
	if (!last || last.role !== "assistant") {
		return { kind: "thinking" };
	}

	let lastSignificant: UIMessage["parts"][number] | undefined;
	for (let i = last.parts.length - 1; i >= 0; i--) {
		const p = last.parts[i];
		if (
			p.type === "reasoning" ||
			p.type === "file" ||
			p.type === "step-start"
		) {
			continue;
		}
		lastSignificant = p;
		break;
	}

	if (!lastSignificant) {
		return { kind: "thinking" };
	}

	if (lastSignificant.type === "text") {
		const text = (lastSignificant as { text?: string }).text ?? "";
		return text.length > 0 ? null : { kind: "thinking" };
	}

	if (isToolPart(lastSignificant)) {
		switch (lastSignificant.state) {
			case "input-streaming":
			case "input-available":
				// Tool block is already rendered with its own pulsing indicator.
				return null;
			case "output-available":
			case "output-error":
				// Dead air between tool result and next text/tool — show shimmer.
				return { kind: "thinking" };
			default:
				return { kind: "thinking" };
		}
	}

	return { kind: "thinking" };
}

export type ThinkingIndicatorProps = HTMLAttributes<HTMLDivElement> & {
	phase: ThinkingPhase;
};

export function ThinkingIndicator({
	phase,
	className,
	...props
}: ThinkingIndicatorProps) {
	if (!phase) {
		return null;
	}

	return (
		<div
			aria-live="polite"
			className={cn("ww:flex ww:items-center ww:py-1", className)}
			{...props}
		>
			<span
				data-waniwani-thinking
				className="ww:text-sm ww:italic"
				style={{
					backgroundImage:
						"linear-gradient(90deg, var(--ww-color-muted-foreground) 0%, var(--ww-color-muted-foreground) 35%, var(--ww-color-foreground) 50%, var(--ww-color-muted-foreground) 65%, var(--ww-color-muted-foreground) 100%)",
					backgroundSize: "200% 100%",
					WebkitBackgroundClip: "text",
					backgroundClip: "text",
					color: "transparent",
					animation:
						"ww-shimmer 1.8s linear infinite, ww-fade-in 0.2s ease-out",
				}}
			>
				Thinking…
			</span>
		</div>
	);
}
