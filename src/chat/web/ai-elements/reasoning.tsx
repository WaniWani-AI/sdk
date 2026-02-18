"use client";

import type { HTMLAttributes } from "react";
import { cn } from "../lib/utils";

export type ReasoningProps = HTMLAttributes<HTMLPreElement> & {
	text: string;
};

/** Displays reasoning text inline with muted styling. */
export function Reasoning({ className, text, ...props }: ReasoningProps) {
	if (!text) return null;

	return (
		<pre
			className={cn(
				"mb-2 overflow-x-auto whitespace-pre-wrap break-words text-xs font-mono text-muted-foreground",
				className,
			)}
			{...props}
		>
			{text}
		</pre>
	);
}
