"use client";

import type { ComponentProps } from "react";
import { cn } from "../lib/utils";
import { Button } from "../ui/button";

export type QueueProps = ComponentProps<"div">;

export const Queue = ({ className, ...props }: QueueProps) => (
	<div
		className={cn("ww:flex ww:flex-col ww:gap-1 ww:px-3 ww:py-2", className)}
		{...props}
	/>
);

export type QueueItemProps = ComponentProps<"li">;

export const QueueItem = ({ className, ...props }: QueueItemProps) => (
	<li
		className={cn(
			"ww:group ww:flex ww:items-center ww:gap-2 ww:rounded-md ww:px-2 ww:py-1 ww:text-sm ww:transition-colors ww:hover:bg-muted",
			className,
		)}
		{...props}
	/>
);

export type QueueItemIndicatorProps = ComponentProps<"span">;

export const QueueItemIndicator = ({
	className,
	...props
}: QueueItemIndicatorProps) => (
	<span
		className={cn(
			"ww:inline-block ww:size-2 ww:shrink-0 ww:rounded-full ww:border ww:border-muted-foreground/50",
			className,
		)}
		{...props}
	/>
);

export type QueueItemContentProps = ComponentProps<"span">;

export const QueueItemContent = ({
	className,
	...props
}: QueueItemContentProps) => (
	<span
		className={cn(
			"ww:line-clamp-1 ww:grow ww:break-words ww:text-muted-foreground",
			className,
		)}
		{...props}
	/>
);

export type QueueItemActionsProps = ComponentProps<"div">;

export const QueueItemActions = ({
	className,
	...props
}: QueueItemActionsProps) => (
	<div
		className={cn(
			"ww:flex ww:shrink-0 ww:gap-1 ww:opacity-0 ww:transition-opacity ww:group-hover:opacity-100",
			className,
		)}
		{...props}
	/>
);

export type QueueItemActionProps = Omit<
	ComponentProps<typeof Button>,
	"variant" | "size"
>;

export const QueueItemAction = ({
	className,
	...props
}: QueueItemActionProps) => (
	<Button
		className={cn(
			"ww:size-auto ww:rounded ww:p-1 ww:text-muted-foreground ww:hover:bg-muted-foreground/10 ww:hover:text-foreground",
			className,
		)}
		size="icon"
		type="button"
		variant="ghost"
		{...props}
	/>
);
