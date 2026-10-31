"use client";

import type { HTMLAttributes } from "react";
import { cn } from "../lib/utils";

export type LoaderProps = HTMLAttributes<HTMLDivElement> & {
	size?: number;
};

export const Loader = ({ className, size = 5, ...props }: LoaderProps) => (
	<div className={cn("ww:flex ww:items-center ww:gap-1", className)} {...props}>
		{[0, 1, 2].map((i) => (
			<div
				key={i}
				className="ww:rounded-full ww:bg-muted-foreground/60"
				style={{
					width: size,
					height: size,
					animation: "ww-pulse 1.4s ease-in-out infinite",
					animationDelay: `${i * 0.2}s`,
				}}
			/>
		))}
	</div>
);
