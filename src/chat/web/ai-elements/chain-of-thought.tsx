"use client";

import type { ToolUIPart } from "ai";
import { ChevronDownIcon, ClockIcon, type LucideIcon } from "lucide-react";
import type { HTMLAttributes, ReactNode } from "react";
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
import { Reasoning, ReasoningContent, ReasoningTrigger } from "./reasoning";
import { Shimmer } from "./shimmer";

const AUTO_CLOSE_DELAY = 1000;
// Delay after the auto-close fires before swapping the header label, so the
// text change trails the collapse animation instead of racing it (smoother).
const SETTLE_AFTER_CLOSE = 240;

interface ChainContextValue {
	open: boolean;
	setOpen: (open: boolean) => void;
	isWorking: boolean;
	/** Latches true only after the chain has finished its post-work collapse,
	 * so the header label swaps after the thread closes — not mid-collapse. */
	settled: boolean;
}

const ChainContext = createContext<ChainContextValue | null>(null);

function useChain(): ChainContextValue {
	const ctx = useContext(ChainContext);
	if (!ctx) {
		throw new Error(
			"ChainOfThought components must be used within <ChainOfThought>",
		);
	}
	return ctx;
}

export type ChainOfThoughtProps = HTMLAttributes<HTMLDivElement> & {
	/** True while any step is still running (no output yet). Drives the
	 * shimmering header and the auto open/close behavior. */
	isWorking?: boolean;
	open?: boolean;
	defaultOpen?: boolean;
	onOpenChange?: (open: boolean) => void;
};

/**
 * Compound root that groups a run of tool-call steps into a single
 * collapsible "chain of thought". Mirrors the {@link Reasoning} lifecycle:
 * auto-opens while work is in flight so the live steps are visible, then
 * auto-collapses ~1s after the last step completes, leaving a tidy header.
 *
 * ```tsx
 * <ChainOfThought isWorking={anyRunning}>
 *   <ChainOfThoughtHeader label="Canopy offer" />
 *   <ChainOfThoughtContent>
 *     <ChainOfThoughtStep icon={WrenchIcon} title="Getting you a quote" state="output-available" />
 *     <ChainOfThoughtStep icon={WrenchIcon} title="Canopy offer" state="input-available" isLast />
 *   </ChainOfThoughtContent>
 * </ChainOfThought>
 * ```
 */
export function ChainOfThought({
	className,
	isWorking = false,
	open,
	defaultOpen,
	onOpenChange,
	children,
	...props
}: ChainOfThoughtProps) {
	const resolvedDefaultOpen = defaultOpen ?? isWorking;

	const isControlled = open !== undefined;
	const [internalOpen, setInternalOpen] = useState(resolvedDefaultOpen);
	const isOpen = isControlled ? open : internalOpen;
	const setOpen = useCallback(
		(next: boolean) => {
			if (!isControlled) {
				setInternalOpen(next);
			}
			onOpenChange?.(next);
		},
		[isControlled, onOpenChange],
	);

	const wasWorkingRef = useRef(isWorking);
	const [hasAutoClosed, setHasAutoClosed] = useState(false);
	const [settled, setSettled] = useState(!isWorking);

	// Auto-open whenever work (re)starts; allow a fresh auto-close after.
	useEffect(() => {
		if (isWorking) {
			wasWorkingRef.current = true;
			setHasAutoClosed(false);
			setSettled(false);
			if (!isControlled) {
				setInternalOpen(true);
			}
		}
	}, [isWorking, isControlled]);

	// Auto-close ~1s after work ends (once per work burst).
	useEffect(() => {
		if (wasWorkingRef.current && !isWorking && isOpen && !hasAutoClosed) {
			const timer = setTimeout(() => {
				setOpen(false);
				setHasAutoClosed(true);
			}, AUTO_CLOSE_DELAY);
			return () => clearTimeout(timer);
		}
	}, [isWorking, isOpen, hasAutoClosed, setOpen]);

	// Latch `settled` only after the close has had time to animate, so the
	// header swaps to the done label *after* the thread collapses.
	useEffect(() => {
		if (wasWorkingRef.current && !isWorking && !settled) {
			const timer = setTimeout(
				() => setSettled(true),
				AUTO_CLOSE_DELAY + SETTLE_AFTER_CLOSE,
			);
			return () => clearTimeout(timer);
		}
	}, [isWorking, settled]);

	const contextValue = useMemo<ChainContextValue>(
		() => ({ open: isOpen, setOpen, isWorking, settled }),
		[isOpen, setOpen, isWorking, settled],
	);

	return (
		<ChainContext.Provider value={contextValue}>
			<div
				className={cn("ww:mb-4 ww:flex ww:flex-col ww:gap-2", className)}
				data-state={isOpen ? "open" : "closed"}
				style={{ animation: "ww-fade-in 0.2s ease-out" }}
				{...props}
			>
				{children}
			</div>
		</ChainContext.Provider>
	);
}

export type ChainOfThoughtHeaderProps = HTMLAttributes<HTMLButtonElement> & {
	/** Generic header label for the settled chain (e.g. "Thought process").
	 * Deliberately not a per-turn summary — just a stable label. */
	label?: string;
	/** Shimmering label while the chain is still working (e.g. "Working on it…").
	 * Falls back to `label`. */
	workingLabel?: string;
};

/**
 * Clickable header that toggles the chain. No leading icon — just the label
 * and a trailing chevron, the cleaner Claude-style treatment. While the chain
 * is working the label shimmers. The step icons live on the timeline below.
 */
export function ChainOfThoughtHeader({
	className,
	label,
	workingLabel,
	children,
	...props
}: ChainOfThoughtHeaderProps) {
	const { open, setOpen, isWorking, settled } = useChain();
	// Working label (shimmering while active, static while collapsing) until the
	// chain has fully settled, then the done label. Keeps the text swap from
	// racing the collapse.
	const content =
		children ??
		(settled ? (
			label
		) : isWorking ? (
			<Shimmer duration={1.6}>{workingLabel ?? label ?? ""}</Shimmer>
		) : (
			(workingLabel ?? label)
		));

	return (
		<button
			type="button"
			onClick={() => setOpen(!open)}
			aria-expanded={open}
			className={cn(
				"ww:flex ww:w-full ww:items-center ww:gap-1.5 ww:text-sm ww:text-muted-foreground ww:transition-colors ww:hover:text-foreground",
				className,
			)}
			{...props}
		>
			<span className="ww:truncate">{content}</span>
			<ChevronDownIcon
				className={cn(
					"ww:size-4 ww:shrink-0 ww:transition-transform ww:duration-200",
					open && "ww:rotate-180",
				)}
			/>
		</button>
	);
}

export type ChainOfThoughtContentProps = HTMLAttributes<HTMLDivElement>;

/** Collapsible body holding the steps. Animates open/closed via a grid-row
 * height transition, same as {@link ToolContent} / {@link ReasoningContent}. */
export function ChainOfThoughtContent({
	className,
	children,
	...props
}: ChainOfThoughtContentProps) {
	const { open } = useChain();
	return (
		<div
			className={cn(
				"ww:grid ww:transition-[grid-template-rows,opacity] ww:duration-200 ww:ease-out",
				open
					? "ww:grid-rows-[1fr] ww:opacity-100"
					: "ww:grid-rows-[0fr] ww:opacity-0",
			)}
		>
			<div className="ww:min-h-0 ww:overflow-hidden">
				<div className={cn("ww:flex ww:flex-col", className)} {...props}>
					{children}
				</div>
			</div>
		</div>
	);
}

/** Shared timeline rail: an icon centered on the first text line, plus a
 * vertical connector down to the next node (omitted on the last). Used by
 * both {@link ChainOfThoughtStep} and {@link ChainOfThoughtReasoning} so all
 * nodes share one continuous line. */
function ChainOfThoughtRail({
	icon: Icon,
	isLast,
	running,
	error,
}: {
	icon: LucideIcon;
	isLast?: boolean;
	running?: boolean;
	error?: boolean;
}) {
	return (
		<div className="ww:flex ww:flex-col ww:items-center ww:self-stretch">
			<span className="ww:flex ww:h-5 ww:items-center">
				<Icon
					className={cn(
						"ww:size-4 ww:shrink-0",
						error
							? "ww:text-destructive"
							: running
								? "ww:animate-pulse ww:text-foreground"
								: "ww:text-muted-foreground",
					)}
				/>
			</span>
			{!isLast && <span className="ww:w-px ww:flex-1 ww:bg-border" />}
		</div>
	);
}

export type ChainOfThoughtStepProps = HTMLAttributes<HTMLDivElement> & {
	/** Timeline icon for this step — e.g. a wrench for a tool call, a globe
	 * for a search. Recolors to reflect running/error state. */
	icon: LucideIcon;
	title?: string;
	state: ToolUIPart["state"];
	/** When true, omits the connecting line below the icon (the timeline tail). */
	isLast?: boolean;
	/** Expandable detail (e.g. request/response JSON). When present the step
	 * row becomes a toggle. Omit for label-only ("titles-only") steps. */
	children?: ReactNode;
};

/**
 * A single step in the chain, rendered as a timeline node: an icon connected
 * by a vertical line to the next step, plus the step title. While running the
 * icon pulses and the title shimmers. If `children` are provided (full mode),
 * the row toggles a collapsible panel holding the tool request/response.
 */
export function ChainOfThoughtStep({
	className,
	icon: Icon,
	title,
	state,
	isLast = false,
	children,
	...props
}: ChainOfThoughtStepProps) {
	const isRunning = state === "input-available" || state === "input-streaming";
	const isError = state === "output-error";
	const expandable = children != null;
	const [open, setOpen] = useState(false);
	const label = title ?? "";

	const labelNode = isRunning ? (
		<Shimmer duration={1.6}>{label}</Shimmer>
	) : (
		<span className="ww:truncate">{label}</span>
	);

	return (
		<div className={cn("ww:flex ww:gap-2", className)} {...props}>
			<ChainOfThoughtRail
				icon={Icon}
				isLast={isLast}
				running={isRunning}
				error={isError}
			/>

			{/* Step body */}
			<div className={cn("ww:min-w-0 ww:flex-1", !isLast && "ww:pb-3")}>
				{expandable ? (
					<button
						type="button"
						onClick={() => setOpen((o) => !o)}
						aria-expanded={open}
						className="ww:flex ww:w-full ww:items-center ww:gap-1.5 ww:text-left ww:text-sm ww:text-muted-foreground ww:transition-colors ww:hover:text-foreground"
					>
						{labelNode}
						<ChevronDownIcon
							className={cn(
								"ww:size-3.5 ww:shrink-0 ww:transition-transform ww:duration-200",
								open && "ww:rotate-180",
							)}
						/>
					</button>
				) : (
					<div className="ww:flex ww:items-center ww:text-sm ww:text-muted-foreground">
						{labelNode}
					</div>
				)}

				{expandable && (
					<div
						className={cn(
							"ww:grid ww:transition-[grid-template-rows,opacity] ww:duration-200 ww:ease-out",
							open
								? "ww:grid-rows-[1fr] ww:opacity-100"
								: "ww:grid-rows-[0fr] ww:opacity-0",
						)}
					>
						<div className="ww:min-h-0 ww:overflow-hidden">
							<div className="ww:mt-2 ww:space-y-3 ww:rounded-lg ww:border ww:border-border ww:bg-background ww:p-3">
								{children}
							</div>
						</div>
					</div>
				)}
			</div>
		</div>
	);
}

export type ChainOfThoughtReasoningProps = {
	/** Whether the reasoning is still streaming (drives shimmer + auto-open). */
	isStreaming?: boolean;
	/** Omits the connector tail when this is the last node in the chain. */
	isLast?: boolean;
	/** The reasoning text (markdown). */
	children: string;
};

/**
 * Reasoning rendered as a chain step: a clock icon on the shared timeline
 * rail, with the {@link Reasoning} trigger ("Thought for X seconds") and its
 * collapsible thinking text as the body. Lets the reasoning trace sit inline
 * among the tool steps in chronological order, on one continuous line.
 */
export function ChainOfThoughtReasoning({
	isStreaming = false,
	isLast = false,
	children,
}: ChainOfThoughtReasoningProps) {
	return (
		<div className="ww:flex ww:gap-2">
			<ChainOfThoughtRail
				icon={ClockIcon}
				isLast={isLast}
				running={isStreaming}
			/>
			<div className={cn("ww:min-w-0 ww:flex-1", !isLast && "ww:pb-3")}>
				<Reasoning isStreaming={isStreaming} className="ww:mb-0">
					<ReasoningTrigger hideIcon />
					<ReasoningContent>{children}</ReasoningContent>
				</Reasoning>
			</div>
		</div>
	);
}
