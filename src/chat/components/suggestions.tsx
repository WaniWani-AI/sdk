"use client";

import type { HTMLAttributes } from "react";
import { cn } from "../lib/utils";

export interface SuggestionsProps
	extends Omit<HTMLAttributes<HTMLDivElement>, "onSelect"> {
	suggestions: string[];
	isLoading?: boolean;
	onSelect: (suggestion: string) => void;
}

export function Suggestions({
	suggestions,
	isLoading,
	onSelect,
	className,
	...props
}: SuggestionsProps) {
	if (suggestions.length === 0 && !isLoading) return null;

	return (
		<div className={cn("flex flex-wrap gap-2 px-3 py-2", className)} {...props}>
			{isLoading
				? [0, 1, 2].map((i) => (
						<div
							key={i}
							className="h-7 rounded-full bg-accent animate-pulse"
							style={{ width: `${60 + i * 20}px` }}
						/>
					))
				: suggestions.map((suggestion, index) => (
						<button
							key={suggestion}
							type="button"
							onClick={() => onSelect(suggestion)}
							className={cn(
								"rounded-full border border-border bg-background px-3 py-1 text-xs",
								"text-foreground hover:bg-accent hover:border-primary/30",
								"transition-all duration-200 ease-out cursor-pointer",
								"animate-[ww-fade-in_0.2s_ease-out_both]",
							)}
							style={{ animationDelay: `${index * 50}ms` }}
						>
							{suggestion}
						</button>
					))}
		</div>
	);
}
