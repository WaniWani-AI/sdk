"use client";

import type { ChatStatus, UIMessage } from "ai";
import { ZapIcon } from "lucide-react";
import type { HTMLAttributes } from "react";
import { useTranslation } from "../i18n";
import { cn } from "../lib/utils";
import { Shimmer } from "./shimmer";

/**
 * True when a UIMessage part renders something visible to the user (text,
 * reasoning, file, or tool). The AI SDK seeds assistant messages with a
 * non-visual `step-start` part before the first real chunk, so naive
 * "has any part" checks would treat that as content.
 */
export function isVisiblePart(part: UIMessage["parts"][number]): boolean {
	return (
		part.type === "text" ||
		part.type === "reasoning" ||
		part.type === "file" ||
		"toolCallId" in part
	);
}

/** True when a message has at least one {@link isVisiblePart}. */
export function hasVisibleParts(message: UIMessage): boolean {
	return message.parts.some(isVisiblePart);
}

/**
 * Returns true when the chat is loading but the assistant has not yet
 * produced any visible content.
 *
 * Pass `ignoreToolParts` when tool calls render nothing (`showToolCalls:
 * false`) — tool parts then don't count as visible content, so the
 * indicator keeps showing while tools run instead of leaving a blank chat.
 */
export function shouldShowWorkingIndicator(
	messages: UIMessage[],
	status: ChatStatus,
	options?: { ignoreToolParts?: boolean },
): boolean {
	if (status !== "submitted" && status !== "streaming") {
		return false;
	}
	const last = messages[messages.length - 1];
	if (!last || last.role !== "assistant") {
		return true;
	}
	const visible = options?.ignoreToolParts
		? last.parts.some((p) => isVisiblePart(p) && !("toolCallId" in p))
		: hasVisibleParts(last);
	return !visible;
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
	const { t } = useTranslation();
	return (
		<div
			aria-live="polite"
			className={cn(
				"ww:mb-4 ww:flex ww:w-full ww:items-center ww:gap-2 ww:text-sm ww:text-muted-foreground",
				className,
			)}
			style={{ animation: "ww-fade-in 0.2s ease-out" }}
			{...props}
		>
			<ZapIcon className="ww:size-4 ww:shrink-0" />
			<Shimmer duration={1.6}>{t.workingIndicator.default}</Shimmer>
		</div>
	);
}
