"use client";

import { ArrowDownIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { useCallback } from "react";
import { StickToBottom, useStickToBottomContext } from "use-stick-to-bottom";
import { cn } from "../lib/utils";
import { Button } from "../ui/button";

export type ConversationProps = ComponentProps<typeof StickToBottom>;

export const Conversation = ({ className, ...props }: ConversationProps) => (
	<StickToBottom
		className={cn("ww:relative ww:flex-1 ww:overflow-y-hidden", className)}
		initial="smooth"
		resize="smooth"
		role="log"
		{...props}
	/>
);

export type ConversationContentProps = ComponentProps<
	typeof StickToBottom.Content
>;

export const ConversationContent = ({
	className,
	...props
}: ConversationContentProps) => (
	<StickToBottom.Content
		className={cn("ww:flex ww:flex-col ww:gap-8 ww:p-4", className)}
		{...props}
	/>
);

export type ConversationScrollButtonProps = ComponentProps<typeof Button>;

export const ConversationScrollButton = ({
	className,
	...props
}: ConversationScrollButtonProps) => {
	const { isAtBottom, scrollToBottom } = useStickToBottomContext();

	const handleScrollToBottom = useCallback(() => {
		scrollToBottom();
	}, [scrollToBottom]);

	return (
		!isAtBottom && (
			<Button
				className={cn(
					"ww:absolute ww:bottom-4 ww:left-[50%] ww:translate-x-[-50%] ww:rounded-full",
					className,
				)}
				onClick={handleScrollToBottom}
				size="icon"
				variant="outline"
				{...props}
			>
				<ArrowDownIcon className="ww:size-4" />
			</Button>
		)
	);
};
