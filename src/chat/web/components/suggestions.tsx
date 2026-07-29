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
	if (suggestions.length === 0 && !isLoading) {
		return null;
	}

	return (
		<div className={cn("ww:px-4 ww:py-2", className)} {...props}>
			<div className="ww:mx-auto ww:w-full ww:max-w-3xl ww:flex ww:flex-wrap ww:gap-2">
				{isLoading
					? [0, 1, 2].map((i) => (
							<div
								key={i}
								className="ww:h-8 ww:rounded-full ww:bg-accent ww:animate-pulse"
								style={{ width: `${60 + i * 20}px` }}
							/>
						))
					: suggestions.map((suggestion, index) => (
							<button
								key={suggestion}
								type="button"
								onClick={() => onSelect(suggestion)}
								className={cn(
									// `bg-accent`, not `bg-background`: inside the open panel the
									// pills sit on the background color itself, where a
									// background-filled pill with a hairline border is
									// indistinguishable from plain text.
									"ww:rounded-full ww:border ww:border-border ww:bg-accent ww:px-3.5 ww:py-1.5 ww:text-sm",
									"ww:text-foreground ww:hover:bg-border ww:hover:border-primary/30",
									"ww:transition-all ww:duration-200 ww:ease-out ww:cursor-pointer",
									"ww:animate-[ww-fade-in_0.2s_ease-out_both]",
								)}
								style={{ animationDelay: `${index * 50}ms` }}
							>
								{suggestion}
							</button>
						))}
			</div>
		</div>
	);
}
