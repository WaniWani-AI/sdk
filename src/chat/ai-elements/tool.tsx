"use client";

import type { ToolUIPart } from "ai";
import {
	CheckCircleIcon,
	ChevronDownIcon,
	CircleIcon,
	ClockIcon,
	WrenchIcon,
	XCircleIcon,
} from "lucide-react";
import type { ComponentProps, HTMLAttributes, ReactNode } from "react";
import { createContext, isValidElement, useContext, useState } from "react";
import { cn } from "../lib/utils";

// ============================================================================
// Collapsible Context (lightweight, no Radix dependency)
// ============================================================================

const ToolOpenContext = createContext<{
	open: boolean;
	toggle: () => void;
}>({ open: false, toggle: () => {} });

// ============================================================================
// Tool
// ============================================================================

export type ToolProps = HTMLAttributes<HTMLDivElement> & {
	defaultOpen?: boolean;
};

export const Tool = ({
	className,
	defaultOpen = false,
	children,
	...props
}: ToolProps) => {
	const [open, setOpen] = useState(defaultOpen);
	return (
		<ToolOpenContext.Provider value={{ open, toggle: () => setOpen((o) => !o) }}>
			<div
				className={cn("mb-4 w-full rounded-md border border-border", className)}
				data-state={open ? "open" : "closed"}
				{...props}
			>
				{children}
			</div>
		</ToolOpenContext.Provider>
	);
};

// ============================================================================
// Status helpers
// ============================================================================

const statusLabels: Record<ToolUIPart["state"], string> = {
	"approval-requested": "Awaiting Approval",
	"approval-responded": "Responded",
	"input-available": "Running",
	"input-streaming": "Pending",
	"output-available": "Completed",
	"output-denied": "Denied",
	"output-error": "Error",
};

const statusIcons: Record<ToolUIPart["state"], ReactNode> = {
	"approval-requested": <ClockIcon className="size-4 text-yellow-600" />,
	"approval-responded": <CheckCircleIcon className="size-4 text-blue-600" />,
	"input-available": <ClockIcon className="size-4 animate-pulse" />,
	"input-streaming": <CircleIcon className="size-4" />,
	"output-available": <CheckCircleIcon className="size-4 text-green-600" />,
	"output-denied": <XCircleIcon className="size-4 text-orange-600" />,
	"output-error": <XCircleIcon className="size-4 text-red-600" />,
};

export const getStatusBadge = (state: ToolUIPart["state"]) => (
	<span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-2 py-0.5 text-xs text-muted-foreground">
		{statusIcons[state]}
		{statusLabels[state]}
	</span>
);

// ============================================================================
// ToolHeader
// ============================================================================

export type ToolHeaderProps = ComponentProps<"button"> & {
	title?: string;
	state: ToolUIPart["state"];
};

export const ToolHeader = ({
	className,
	title,
	state,
	...props
}: ToolHeaderProps) => {
	const { open, toggle } = useContext(ToolOpenContext);

	return (
		<button
			type="button"
			onClick={toggle}
			className={cn(
				"flex w-full items-center justify-between gap-4 p-3",
				className,
			)}
			aria-expanded={open}
			{...props}
		>
			<div className="flex items-center gap-2">
				<WrenchIcon className="size-4 text-muted-foreground" />
				<span className="text-sm font-medium">{title}</span>
				{getStatusBadge(state)}
			</div>
			<ChevronDownIcon
				className={cn(
					"size-4 text-muted-foreground transition-transform",
					open && "rotate-180",
				)}
			/>
		</button>
	);
};

// ============================================================================
// ToolContent
// ============================================================================

export type ToolContentProps = HTMLAttributes<HTMLDivElement>;

export const ToolContent = ({
	className,
	children,
	...props
}: ToolContentProps) => {
	const { open } = useContext(ToolOpenContext);

	if (!open) return null;

	return (
		<div className={cn("space-y-4 p-4", className)} {...props}>
			{children}
		</div>
	);
};

// ============================================================================
// ToolInput
// ============================================================================

export type ToolInputProps = HTMLAttributes<HTMLDivElement> & {
	input: ToolUIPart["input"];
};

export const ToolInput = ({
	className,
	input,
	...props
}: ToolInputProps) => (
	<div className={cn("space-y-2 overflow-hidden", className)} {...props}>
		<h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
			Parameters
		</h4>
		<pre className="overflow-x-auto rounded-md bg-muted/50 p-3 text-xs">
			<code>{JSON.stringify(input, null, 2)}</code>
		</pre>
	</div>
);

// ============================================================================
// ToolOutput
// ============================================================================

export type ToolOutputProps = HTMLAttributes<HTMLDivElement> & {
	output: ToolUIPart["output"];
	errorText: ToolUIPart["errorText"];
};

export const ToolOutput = ({
	className,
	output,
	errorText,
	...props
}: ToolOutputProps) => {
	if (!(output || errorText)) return null;

	let rendered: ReactNode;

	if (typeof output === "object" && !isValidElement(output)) {
		rendered = (
			<pre className="overflow-x-auto p-3 text-xs">
				<code>{JSON.stringify(output, null, 2)}</code>
			</pre>
		);
	} else if (typeof output === "string") {
		rendered = (
			<pre className="overflow-x-auto p-3 text-xs">
				<code>{output}</code>
			</pre>
		);
	} else {
		rendered = <div className="p-3">{output as ReactNode}</div>;
	}

	return (
		<div className={cn("space-y-2", className)} {...props}>
			<h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
				{errorText ? "Error" : "Result"}
			</h4>
			<div
				className={cn(
					"overflow-x-auto rounded-md text-xs",
					errorText
						? "bg-destructive/10 text-destructive"
						: "bg-muted/50 text-foreground",
				)}
			>
				{errorText && <div className="p-3">{errorText}</div>}
				{rendered}
			</div>
		</div>
	);
};
