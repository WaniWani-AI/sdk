"use client";

import type { CSSProperties, ElementType, HTMLAttributes } from "react";
import { memo } from "react";
import { cn } from "../lib/utils";

export type ShimmerProps = HTMLAttributes<HTMLElement> & {
	as?: ElementType;
	/** Animation duration in seconds. Defaults to 2s. */
	duration?: number;
	children: string;
};

/**
 * Text shimmer effect — a moving highlight sweeps across the muted text
 * to signal an ongoing async action. CSS-only; no motion/framer dependency.
 *
 * Visual: text rendered in `--ww-color-muted-foreground`, with a narrow
 * brighter band (`--ww-color-foreground`) sweeping left→right on loop.
 */
const ShimmerComponent = ({
	as: Component = "span",
	className,
	duration = 2,
	style,
	children,
	...props
}: ShimmerProps) => {
	const mergedStyle: CSSProperties = {
		backgroundImage:
			"linear-gradient(90deg, var(--ww-color-muted-foreground) 0%, var(--ww-color-muted-foreground) 40%, var(--ww-color-foreground) 50%, var(--ww-color-muted-foreground) 60%, var(--ww-color-muted-foreground) 100%)",
		backgroundSize: "250% 100%",
		WebkitBackgroundClip: "text",
		backgroundClip: "text",
		color: "transparent",
		animation: `ww-shimmer ${duration}s linear infinite`,
		...style,
	};

	return (
		<Component
			data-waniwani-shimmer=""
			className={cn("ww:inline-block", className)}
			style={mergedStyle}
			{...props}
		>
			{children}
		</Component>
	);
};

export const Shimmer = memo(ShimmerComponent);
Shimmer.displayName = "Shimmer";
