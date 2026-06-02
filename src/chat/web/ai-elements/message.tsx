"use client";

import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import type { UIMessage } from "ai";
import type { ComponentProps, HTMLAttributes, ReactNode } from "react";
import { memo } from "react";
import { Streamdown } from "streamdown";
import { useSmoothStream } from "../hooks/use-smooth-stream";
import { cn } from "../lib/utils";

export type MessageProps = HTMLAttributes<HTMLDivElement> & {
	from: UIMessage["role"];
	children?: ReactNode;
};

export const Message = ({
	className,
	from,
	children,
	...props
}: MessageProps) => (
	<div
		className={cn(
			"ww:group ww:flex ww:w-full",
			from === "user"
				? "is-user ww:ml-auto ww:max-w-[80%] ww:flex-col ww:items-end"
				: "is-assistant ww:flex-col",
			className,
		)}
		{...props}
	>
		<div className={cn("ww:flex ww:min-w-0 ww:flex-col ww:gap-2", "ww:w-full")}>
			{children}
		</div>
	</div>
);

export type MessageContentProps = HTMLAttributes<HTMLDivElement>;

export const MessageContent = ({
	children,
	className,
	...props
}: MessageContentProps) => (
	<div
		className={cn(
			"ww:flex ww:w-fit ww:min-w-0 ww:max-w-full ww:flex-col ww:gap-2 ww:overflow-hidden ww:text-base",
			"ww:group-[.is-user]:ml-auto ww:group-[.is-user]:rounded-lg ww:group-[.is-user]:bg-user-bubble ww:group-[.is-user]:px-4 ww:group-[.is-user]:py-3 ww:group-[.is-user]:text-primary-foreground",
			"ww:group-[.is-assistant]:text-foreground",
			className,
		)}
		{...props}
	>
		{children}
	</div>
);

export type MessageResponseProps = ComponentProps<typeof Streamdown> & {
	isStreaming?: boolean;
};

const streamdownPluginsFull = { cjk, code };
const streamdownPluginsStreaming = { cjk };
const defaultLinkSafety = { enabled: false } as const;

function MessageResponseImpl({
	className,
	linkSafety,
	isStreaming,
	children,
	...props
}: MessageResponseProps) {
	const fullText = typeof children === "string" ? children : "";
	const smoothed = useSmoothStream(fullText, Boolean(isStreaming));
	const rendered = typeof children === "string" ? smoothed : children;

	return (
		<Streamdown
			className={cn(
				"ww:size-full ww:[&>*:first-child]:mt-0 ww:[&>*:last-child]:mb-0",
				className,
			)}
			linkSafety={linkSafety ?? defaultLinkSafety}
			plugins={isStreaming ? streamdownPluginsStreaming : streamdownPluginsFull}
			{...props}
		>
			{rendered}
		</Streamdown>
	);
}

export const MessageResponse = memo(
	MessageResponseImpl,
	(prevProps, nextProps) =>
		prevProps.children === nextProps.children &&
		prevProps.isStreaming === nextProps.isStreaming,
);

MessageResponse.displayName = "MessageResponse";
