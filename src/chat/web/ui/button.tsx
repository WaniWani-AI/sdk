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
			"ww:inline-flex ww:cursor-pointer ww:items-center ww:justify-center ww:rounded-md ww:font-medium ww:transition-colors ww:disabled:pointer-events-none ww:disabled:opacity-50",
			variant === "default" &&
				"ww:bg-primary ww:text-primary-foreground ww:hover:bg-primary/90",
			variant === "outline" &&
				"ww:border ww:border-border ww:bg-background ww:hover:bg-accent ww:hover:text-accent-foreground",
			variant === "ghost" &&
				"ww:hover:bg-accent ww:hover:text-accent-foreground",
			size === "default" && "ww:h-9 ww:px-4 ww:py-2 ww:text-sm",
			size === "sm" && "ww:h-8 ww:px-3 ww:text-xs",
			size === "icon" && "ww:size-9",
			size === "icon-sm" && "ww:size-7",
			className,
		)}
		{...props}
	/>
);
