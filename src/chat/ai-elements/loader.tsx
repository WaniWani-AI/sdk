"use client";

import type { HTMLAttributes } from "react";
import { cn } from "../lib/utils";

export type LoaderProps = HTMLAttributes<HTMLDivElement> & {
	size?: number;
};

export const Loader = ({ className, size = 8, ...props }: LoaderProps) => (
	<div className={cn("flex items-center gap-1", className)} {...props}>
		{[0, 1, 2].map((i) => (
			<div
				key={i}
				className="animate-bounce rounded-full bg-muted-foreground"
				style={{
					width: size,
					height: size,
					animationDelay: `${i * 0.15}s`,
				}}
			/>
		))}
	</div>
);
