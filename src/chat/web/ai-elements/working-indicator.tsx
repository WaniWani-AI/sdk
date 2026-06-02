"use client";

import type { ChatStatus, UIMessage } from "ai";
import { SparklesIcon } from "lucide-react";
import type { HTMLAttributes } from "react";
import { cn } from "../lib/utils";
import { Shimmer } from "./shimmer";

/**
 * Returns true when the chat is loading but the assistant has not yet
 * produced any *visible* content (text, reasoning, file, or tool part).
 */
export function shouldShowWorkingIndicator(
	messages: UIMessage[],
	status: ChatStatus,
): boolean {
	if (status !== "submitted" && status !== "streaming") {
		return false;
	}
	const last = messages[messages.length - 1];
	if (!last || last.role !== "assistant") {
		return true;
	}
	const hasVisible = last.parts.some(
		(p) =>
			p.type === "text" ||
			p.type === "reasoning" ||
			p.type === "file" ||
			"toolCallId" in p,
	);
	return !hasVisible;
}

export type WorkingIndicatorProps = HTMLAttributes<HTMLDivElement>;

/**
 * Pre-stream activity indicator. Mirrors the Reasoning / Tool trigger
 * layout (size-4 icon + Shimmer label, muted-foreground, gap-2) so the
 * three "agent is doing something" states share one visual language.
 */
export function WorkingIndicator({
	className,
	...props
}: WorkingIndicatorProps) {
	return (
		<div
			aria-live="polite"
			className={cn(
				"ww:flex ww:w-full ww:items-center ww:gap-2 ww:text-sm ww:text-muted-foreground",
				className,
			)}
			{...props}
		>
			<SparklesIcon className="ww:size-4 ww:shrink-0" />
			<Shimmer duration={1.6}>Working…</Shimmer>
		</div>
	);
}
