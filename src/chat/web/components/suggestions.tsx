"use client";

import type { CSSProperties, HTMLAttributes } from "react";
import { HOOKS } from "../hooks-contract";
import type { SuggestionOrigin } from "../lib/resolve-suggestions";
import { cn } from "../lib/utils";

export interface SuggestionsProps
	extends Omit<HTMLAttributes<HTMLDivElement>, "onSelect"> {
	suggestions: string[];
	isLoading?: boolean;
	onSelect: (suggestion: string) => void;
	/** Horizontal alignment of the pill row. Defaults to `"start"`. */
	align?: "start" | "center";
	origin?: SuggestionOrigin | "welcome" | "dock";
	layout?: "wrap" | "single-row";
}

export function Suggestions({
	suggestions,
	isLoading,
	onSelect,
	align = "start",
	origin,
	layout = "wrap",
	className,
	...props
}: SuggestionsProps) {
	if (suggestions.length === 0 && !isLoading) {
		return null;
	}

	return (
		<div
			className={cn(HOOKS.suggestions, "ww:px-4 ww:py-2", className)}
			data-layout={layout}
			data-origin={origin}
			{...props}
		>
			<div
				className={cn(
					"ww:mx-auto ww:w-full ww:max-w-[var(--ww-content-max-width)] ww:flex ww:flex-wrap ww:gap-2",
					align === "center" && "ww:justify-center",
				)}
			>
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
								data-origin={origin}
								data-index={index}
								className={cn(
									HOOKS.suggestion,
									// `bg-accent`, not `bg-background`: inside the open panel the
									// pills sit on the background color itself, where a
									// background-filled pill with a hairline border is
									// indistinguishable from plain text.
									"ww:rounded-[var(--ww-suggestion-radius)] ww:border ww:border-[color:var(--ww-suggestion-border)] ww:bg-[color:var(--ww-suggestion-bg)] ww:px-3.5 ww:py-1.5 ww:text-sm",
									"ww:text-[color:var(--ww-suggestion-fg)] ww:hover:bg-[color:var(--ww-suggestion-hover-bg)] ww:hover:border-primary/30",
									"ww:transition-all ww:duration-200 ww:ease-out ww:cursor-pointer",
								)}
								style={{ "--ww-index": index } as CSSProperties}
							>
								{suggestion}
							</button>
						))}
			</div>
		</div>
	);
}
