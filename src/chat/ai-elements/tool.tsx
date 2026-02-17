"use client";

import type { ToolUIPart } from "ai";
import {
	BracesIcon,
	CheckCircleIcon,
	CheckIcon,
	ChevronDownIcon,
	ChevronRightIcon,
	CircleIcon,
	ClipboardCopyIcon,
	ClockIcon,
	ServerIcon,
	XCircleIcon,
} from "lucide-react";
import type { ComponentProps, HTMLAttributes, ReactNode } from "react";
import { createContext, useContext, useState } from "react";
import { cn } from "../lib/utils";
import { Button } from "../ui/button";

// ============================================================================
// Truncated JSON preview
// ============================================================================

function truncateJSON(data: unknown, maxLength = 80): string {
	if (data === null || data === undefined) return String(data);
	if (typeof data !== "object") return String(data).slice(0, maxLength);

	const stringified = JSON.stringify(data);
	if (stringified.length <= maxLength) return stringified;

	if (!Array.isArray(data)) {
		const entries = Object.entries(data as Record<string, unknown>);
		const parts: string[] = [];
		let remaining = maxLength - 2;

		for (const [key, value] of entries) {
			if (remaining <= 8) break;
			const keyAbbrev = key.length > 4 ? `${key.slice(0, 4)}\u2026` : key;
			let valStr: string;
			if (typeof value === "string") {
				valStr =
					value.length > 2 ? `'${value.slice(0, 1)}\u2026` : `'${value}'`;
			} else if (Array.isArray(value)) {
				valStr = `Array(${value.length})`;
			} else if (typeof value === "object" && value !== null) {
				valStr = `{\u2026}`;
			} else {
				valStr = String(value);
			}
			const part = `${keyAbbrev}\u2009${valStr}`;
			parts.push(part);
			remaining -= part.length + 3;
		}

		return `{${parts.join(",  ")}}`;
	}

	return `Array(${(data as unknown[]).length})`;
}

// ============================================================================
// CopyButton
// ============================================================================

const CopyButton = ({
	text,
	className,
	...props
}: ComponentProps<"button"> & { text: string }) => {
	const [copied, setCopied] = useState(false);

	const handleCopy = async (e: React.MouseEvent) => {
		e.stopPropagation();
		try {
			await navigator.clipboard.writeText(text);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		} catch {
			// Clipboard not available
		}
	};

	return (
		<Button
			variant="ghost"
			size="sm"
			onClick={handleCopy}
			className={cn(
				"h-auto gap-1 px-1.5 py-0.5 text-xs text-muted-foreground hover:text-foreground",
				className,
			)}
			{...props}
		>
			{copied ? (
				<>
					<CheckIcon className="size-3.5" />
					<span>Copied</span>
				</>
			) : (
				<>
					<ClipboardCopyIcon className="size-3.5" />
					<span>Copy</span>
				</>
			)}
		</Button>
	);
};

// ============================================================================
// CollapsibleJSON
// ============================================================================

const CollapsibleJSON = ({
	data,
	label,
	className,
	...props
}: HTMLAttributes<HTMLDivElement> & {
	data: unknown;
	label: string;
}) => {
	const [expanded, setExpanded] = useState(false);
	const fullJSON = JSON.stringify(data, null, 2);
	const preview = truncateJSON(data);

	return (
		<div
			className={cn("rounded-lg border border-border", className)}
			{...props}
		>
			{/* Header row */}
			<div className="flex items-center justify-between px-3 pt-2.5 pb-1.5">
				<span className="text-xs font-medium text-muted-foreground">
					{label}
				</span>
				<CopyButton text={fullJSON} />
			</div>
			{/* JSON preview / expanded */}
			<button
				type="button"
				onClick={() => setExpanded((v) => !v)}
				className="flex w-full items-start gap-2 px-3 pb-3 text-left"
			>
				<ChevronRightIcon
					className={cn(
						"mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-transform duration-150",
						expanded && "rotate-90",
					)}
				/>
				{expanded ? (
					<pre className="overflow-x-auto text-xs font-mono text-foreground whitespace-pre-wrap break-all">
						<code>{fullJSON}</code>
					</pre>
				) : (
					<span className="truncate text-xs font-mono text-foreground/80">
						{preview}
					</span>
				)}
			</button>
		</div>
	);
};

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
		<ToolOpenContext.Provider
			value={{ open, toggle: () => setOpen((o) => !o) }}
		>
			<div
				className={cn("mb-4 w-full", className)}
				data-state={open ? "open" : "closed"}
				{...props}
			>
				{children}
			</div>
		</ToolOpenContext.Provider>
	);
};

// ============================================================================
// Status helpers (kept for backward compat)
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
	const isRunning = state === "input-available" || state === "input-streaming";

	return (
		<button
			type="button"
			onClick={toggle}
			className={cn(
				"flex w-full items-center justify-between gap-3 py-1.5",
				className,
			)}
			aria-expanded={open}
			{...props}
		>
			<div className="flex min-w-0 items-center gap-2">
				<BracesIcon className="size-4 shrink-0 text-muted-foreground" />
				<span className="truncate text-sm font-medium">{title}</span>
				{isRunning && (
					<span className="size-2 shrink-0 rounded-full bg-primary animate-pulse" />
				)}
			</div>
			<ChevronDownIcon
				className={cn(
					"size-4 shrink-0 text-muted-foreground transition-transform duration-200",
					open && "rotate-180",
				)}
			/>
		</button>
	);
};

// ============================================================================
// ToolServerInfo
// ============================================================================

export type ToolServerInfoProps = HTMLAttributes<HTMLDivElement> & {
	serverName?: string;
	serverIcon?: string;
	toolName: string;
};

export const ToolServerInfo = ({
	className,
	serverName,
	serverIcon,
	toolName,
	...props
}: ToolServerInfoProps) => {
	return (
		<div
			className={cn(
				"flex items-center gap-3 rounded-lg border border-border px-3 py-2.5",
				className,
			)}
			{...props}
		>
			{serverIcon ? (
				<img
					src={serverIcon}
					alt={serverName ?? ""}
					className="size-8 shrink-0 rounded-full object-cover"
				/>
			) : (
				<div className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border bg-muted">
					<ServerIcon className="size-4 text-muted-foreground" />
				</div>
			)}
			<div className="flex min-w-0 flex-col">
				{serverName && (
					<span className="text-xs text-muted-foreground">{serverName}</span>
				)}
				<span className="truncate text-sm font-semibold">{toolName}</span>
			</div>
		</div>
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
		<div
			className={cn(
				"mt-2 space-y-3 rounded-lg border border-border p-3",
				className,
			)}
			{...props}
		>
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

export const ToolInput = ({ className, input, ...props }: ToolInputProps) => (
	<CollapsibleJSON
		data={input}
		label="Request"
		className={className}
		{...props}
	/>
);

// ============================================================================
// ToolOutput
// ============================================================================

export type ToolOutputProps = HTMLAttributes<HTMLDivElement> & {
	output: ToolUIPart["output"];
	errorText: ToolUIPart["errorText"];
};

/**
 * Extract the MCP app resource URI from a tool output's _meta field.
 */
export function getResourceUri(output: unknown): string | undefined {
	if (typeof output !== "object" || output === null) return undefined;
	const meta = (output as Record<string, unknown>)._meta;
	if (typeof meta !== "object" || meta === null) return undefined;
	const ui = (meta as Record<string, unknown>).ui;
	if (typeof ui !== "object" || ui === null) return undefined;
	const uri = (ui as Record<string, unknown>).resourceUri;
	return typeof uri === "string" ? uri : undefined;
}

export const ToolOutput = ({
	className,
	output,
	errorText,
	...props
}: ToolOutputProps) => {
	if (!(output || errorText)) return null;

	if (errorText) {
		return (
			<div className={cn("space-y-2", className)} {...props}>
				<h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
					Error
				</h4>
				<div className="rounded-lg bg-destructive/10 p-3 text-xs text-destructive">
					{errorText}
				</div>
			</div>
		);
	}

	return (
		<CollapsibleJSON
			data={output}
			label="Response"
			className={className}
			{...props}
		/>
	);
};
