"use client";

import type { ComponentProps } from "react";
import { cn } from "../lib/utils";

export type ButtonProps = ComponentProps<"button"> & {
	variant?: "default" | "outline" | "ghost";
	size?: "default" | "sm" | "icon" | "icon-sm";
};

export const Button = ({
	className,
	variant = "default",
	size = "default",
	type = "button",
	...props
}: ButtonProps) => (
	<button
		type={type}
		className={cn(
			"inline-flex cursor-pointer items-center justify-center rounded-md font-medium transition-colors disabled:pointer-events-none disabled:opacity-50",
			variant === "default" &&
				"bg-primary text-primary-foreground hover:bg-primary/90",
			variant === "outline" &&
				"border border-border bg-background hover:bg-accent hover:text-accent-foreground",
			variant === "ghost" && "hover:bg-accent hover:text-accent-foreground",
			size === "default" && "h-9 px-4 py-2 text-sm",
			size === "sm" && "h-8 px-3 text-xs",
			size === "icon" && "size-9",
			size === "icon-sm" && "size-7",
			className,
		)}
		{...props}
	/>
);
