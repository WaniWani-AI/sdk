"use client";

import type { WelcomeConfig } from "../@types";
import { cn } from "../lib/utils";

interface WelcomeScreenProps extends WelcomeConfig {
	onSuggestionSelect?: (suggestion: string) => void;
}

export function WelcomeScreen({
	icon,
	title,
	description,
	suggestions,
	onSuggestionSelect,
}: WelcomeScreenProps) {
	return (
		<div className="ww:flex ww:flex-col ww:items-center ww:justify-center ww:py-12 ww:px-6 ww:text-center ww:min-h-full">
			{icon && (
				<div className="ww:mb-4 ww:flex ww:items-center ww:justify-center ww:size-12 ww:rounded-xl ww:bg-foreground ww:text-background">
					{icon}
				</div>
			)}
			<h2 className="ww:text-lg ww:font-semibold ww:text-foreground">
				{title}
			</h2>
			{description && (
				<p className="ww:mt-1 ww:text-sm ww:text-muted-foreground ww:max-w-sm">
					{description}
				</p>
			)}
			{suggestions && suggestions.length > 0 && (
				<div className="ww:mt-6 ww:w-full ww:max-w-md ww:flex ww:flex-col ww:gap-2">
					{suggestions.map((suggestion, index) => (
						<button
							key={suggestion}
							type="button"
							onClick={() => onSuggestionSelect?.(suggestion)}
							className={cn(
								"ww:w-full ww:text-left ww:rounded-xl ww:border ww:border-border ww:bg-background ww:px-4 ww:py-3 ww:text-sm",
								"ww:text-foreground ww:hover:bg-accent ww:hover:border-primary/30",
								"ww:transition-all ww:duration-200 ww:ease-out ww:cursor-pointer",
								"ww:animate-[ww-fade-in_0.2s_ease-out_both]",
							)}
							style={{ animationDelay: `${index * 50}ms` }}
						>
							{suggestion}
						</button>
					))}
				</div>
			)}
		</div>
	);
}
