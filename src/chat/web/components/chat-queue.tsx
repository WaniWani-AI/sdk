"use client";

import { XIcon } from "lucide-react";
import { memo, useCallback } from "react";
import {
	Queue,
	QueueItem,
	QueueItemAction,
	QueueItemActions,
	QueueItemContent,
	QueueItemIndicator,
} from "../ai-elements/queue";
import type { QueuedMessage } from "../hooks/use-chat-engine";
import { cn } from "../lib/utils";

interface ChatQueueItemProps {
	message: QueuedMessage;
	onRemove: (id: string) => void;
}

const ChatQueueItem = memo(({ message, onRemove }: ChatQueueItemProps) => {
	const handleRemove = useCallback(
		() => onRemove(message.id),
		[onRemove, message.id],
	);

	return (
		<QueueItem>
			<QueueItemIndicator />
			<QueueItemContent>{message.text || "(attachment)"}</QueueItemContent>
			<QueueItemActions>
				<QueueItemAction aria-label="Remove from queue" onClick={handleRemove}>
					<XIcon className="ww:size-3" />
				</QueueItemAction>
			</QueueItemActions>
		</QueueItem>
	);
});

ChatQueueItem.displayName = "ChatQueueItem";

interface ChatQueueProps {
	queuedMessages: QueuedMessage[];
	onRemove: (id: string) => void;
	className?: string;
}

export function ChatQueue({
	queuedMessages,
	onRemove,
	className,
}: ChatQueueProps) {
	if (queuedMessages.length === 0) return null;

	return (
		<Queue className={cn("ww:border-t ww:border-border", className)}>
			<div className="ww:text-[11px] ww:font-medium ww:text-muted-foreground ww:px-2">
				{queuedMessages.length} queued
			</div>
			<ul>
				{queuedMessages.map((msg) => (
					<ChatQueueItem key={msg.id} message={msg} onRemove={onRemove} />
				))}
			</ul>
		</Queue>
	);
}
