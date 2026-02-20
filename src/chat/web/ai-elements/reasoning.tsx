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
				"ww:mb-2 ww:overflow-x-auto ww:whitespace-pre-wrap ww:break-words ww:text-xs ww:font-mono ww:text-muted-foreground",
				className,
			)}
			{...props}
		>
			{text}
		</pre>
	);
}
