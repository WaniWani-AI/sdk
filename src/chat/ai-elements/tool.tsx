"use client";

import type { ToolUIPart } from "ai";
import {
	BracesIcon,
	CheckIcon,
	ChevronDownIcon,
	ChevronRightIcon,
	ClipboardCopyIcon,
	ServerIcon,
} from "lucide-react";
import type { HTMLAttributes } from "react";
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { cn } from "../lib/utils";
import { Button } from "../ui/button";

/**
 * Produces an abbreviated single-line JSON preview for collapsed display.
 * Objects show truncated keys/values: `{ci… 'M…,  pos… '2…,  squa… 80}`
 * Arrays show their length: `Array(13)`
 */
function truncateJSON(data: unknown, maxLength = 80): string {
	if (data === null || data === undefined) return String(data);
	if (typeof data !== "object") return String(data).slice(0, maxLength);

	if (Array.isArray(data)) {
		return `Array(${data.length})`;
	}

	const stringified = JSON.stringify(data);
	if (stringified.length <= maxLength) return stringified;

	const entries = Object.entries(data as Record<string, unknown>);
	const parts: string[] = [];
	let remaining = maxLength - 2;

	for (const [key, value] of entries) {
		if (remaining <= 8) break;
		const keyAbbrev = key.length > 4 ? `${key.slice(0, 4)}\u2026` : key;
		let valStr: string;
		if (typeof value === "string") {
			valStr = value.length > 2 ? `'${value.slice(0, 1)}\u2026` : `'${value}'`;
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

interface CopyButtonProps {
	text: string;
	className?: string;
}

/** Ghost button that copies `text` to clipboard, showing "Copied" for 2s. */
function CopyButton({ text, className }: CopyButtonProps) {
	const [copied, setCopied] = useState(false);
	const timeoutRef = useRef<ReturnType<typeof setTimeout>>(null);

	useEffect(() => {
		return () => {
			if (timeoutRef.current) {
				clearTimeout(timeoutRef.current);
			}
		};
	}, []);

	const handleCopy = useCallback(
		async (e: React.MouseEvent) => {
			e.stopPropagation();
			try {
				await navigator.clipboard.writeText(text);
				setCopied(true);
				if (timeoutRef.current) {
					clearTimeout(timeoutRef.current);
				}
				timeoutRef.current = setTimeout(() => setCopied(false), 2000);
			} catch {
				// Clipboard API not available
			}
		},
		[text],
	);

	return (
		<Button
			variant="ghost"
			size="sm"
			onClick={handleCopy}
			className={cn(
				"h-auto gap-1 px-1.5 py-0.5 text-xs text-muted-foreground hover:text-foreground",
				className,
			)}
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
}

interface CollapsibleJSONProps extends HTMLAttributes<HTMLDivElement> {
	data: unknown;
	label: string;
}

/**
 * Labeled JSON section with a Copy button and a collapsible preview.
 * Collapsed: shows a truncated single-line abbreviation with a `>` chevron.
 * Expanded: rotates the chevron and shows full pretty-printed JSON.
 */
function CollapsibleJSON({
	data,
	label,
	className,
	...props
}: CollapsibleJSONProps) {
	const [expanded, setExpanded] = useState(false);
	const fullJSON = useMemo(() => JSON.stringify(data, null, 2), [data]);
	const preview = truncateJSON(data);

	return (
		<div className={cn("rounded-lg bg-tool-card", className)} {...props}>
			<div className="flex items-center justify-between px-3 pt-2.5 pb-1.5">
				<span className="text-xs font-medium text-muted-foreground">
					{label}
				</span>
				<CopyButton text={fullJSON} />
			</div>
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
}

const ToolOpenContext = createContext<{
	open: boolean;
	toggle: () => void;
}>({ open: false, toggle: () => {} });

export type ToolProps = HTMLAttributes<HTMLDivElement> & {
	defaultOpen?: boolean;
};

/**
 * Compound component root for a tool call display.
 * Provides open/closed state via context to ToolHeader and ToolContent.
 *
 * ```tsx
 * <Tool defaultOpen>
 *   <ToolHeader title="Price estimate ready" state="output-available" />
 *   <ToolContent>
 *     <ToolServerInfo toolName="get_price_estimate" serverName="Tuio v2" />
 *     <ToolInput input={args} />
 *     <ToolOutput output={result} errorText={undefined} />
 *   </ToolContent>
 * </Tool>
 * ```
 */
export function Tool({
	className,
	defaultOpen = false,
	children,
	...props
}: ToolProps) {
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
}

export type ToolHeaderProps = HTMLAttributes<HTMLButtonElement> & {
	title?: string;
	state: ToolUIPart["state"];
};

/** Clickable header that toggles the tool accordion. Shows a `{≡}` icon, title, and chevron. */
export function ToolHeader({
	className,
	title,
	state,
	...props
}: ToolHeaderProps) {
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
}

export type ToolServerInfoProps = HTMLAttributes<HTMLDivElement> & {
	serverName?: string;
	serverIcon?: string;
	toolName: string;
};

/** Optional MCP server identity card. Shows server icon + name and the tool function name. Renders nothing if no props need display. */
export function ToolServerInfo({
	className,
	serverName,
	serverIcon,
	toolName,
	...props
}: ToolServerInfoProps) {
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
}

export type ToolContentProps = HTMLAttributes<HTMLDivElement>;

/** Collapsible body that animates open/closed. Content below smoothly pushes up/down via a grid-row height transition. */
export function ToolContent({
	className,
	children,
	...props
}: ToolContentProps) {
	const { open } = useContext(ToolOpenContext);

	return (
		<div
			className={cn(
				"grid transition-[grid-template-rows,opacity] duration-200 ease-out",
				open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
			)}
		>
			<div className="min-h-0 overflow-hidden">
				<div
					className={cn(
						"mt-2 space-y-3 rounded-lg border border-border bg-background p-3",
						className,
					)}
					{...props}
				>
					{children}
				</div>
			</div>
		</div>
	);
}

export type ToolInputProps = HTMLAttributes<HTMLDivElement> & {
	input: ToolUIPart["input"];
};

/** Displays the tool call request parameters as a collapsible JSON section labeled "Request". */
export function ToolInput({ className, input, ...props }: ToolInputProps) {
	return (
		<CollapsibleJSON
			data={input}
			label="Request"
			className={className}
			{...props}
		/>
	);
}

export type ToolOutputProps = HTMLAttributes<HTMLDivElement> & {
	output: ToolUIPart["output"];
	errorText: ToolUIPart["errorText"];
};

/** Extract the MCP app resource URI from `output._meta.ui.resourceUri`, if present. */
export function getResourceUri(output: unknown): string | undefined {
	if (typeof output !== "object" || output === null) return undefined;
	const meta = (output as Record<string, unknown>)._meta;
	if (typeof meta !== "object" || meta === null) return undefined;
	const ui = (meta as Record<string, unknown>).ui;
	if (typeof ui !== "object" || ui === null) return undefined;
	const uri = (ui as Record<string, unknown>).resourceUri;
	return typeof uri === "string" ? uri : undefined;
}

/** Displays the tool call result as a collapsible JSON section labeled "Response", or an error block if `errorText` is set. */
export function ToolOutput({
	className,
	output,
	errorText,
	...props
}: ToolOutputProps) {
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
}
