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
	useState,
} from "react";
import { cn } from "../lib/utils";
import { Reasoning, ReasoningContent, ReasoningTrigger } from "./reasoning";
import { Shimmer } from "./shimmer";

// After work ends, hold the last action on the single-line ticker for a beat
// (shimmer off, label static) before swapping to the settled accordion header,
// so the transition reads as "landed" rather than an abrupt cut.
const SETTLE_DELAY = 500;

/** A single live action shown on the collapsed chain's one-line ticker: the
 * step's timeline icon plus a short label (e.g. a wrench + "Getting a quote"). */
export type ChainStep = {
	icon: LucideIcon;
	label: string;
};

interface ChainContextValue {
	open: boolean;
	setOpen: (open: boolean) => void;
	isWorking: boolean;
	/** Latches true once the run is done (after {@link SETTLE_DELAY}). While
	 * false the header is the live single-line ticker; once true it becomes the
	 * clickable "Thought process" accordion. */
	settled: boolean;
	/** The in-flight step — drives the ticker while unsettled. */
	activeStep?: ChainStep;
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
	/** True while the turn is still in flight. While true the chain stays
	 * collapsed and the header is a live single-line ticker of {@link activeStep};
	 * when it flips false the chain settles into a clickable accordion. */
	isWorking?: boolean;
	/** The step being executed. While working, the collapsed chain shows this
	 * as one shimmering line, swapping cleanly as the step changes. Ignored once
	 * the chain has settled. */
	activeStep?: ChainStep;
	open?: boolean;
	defaultOpen?: boolean;
	onOpenChange?: (open: boolean) => void;
};

/**
 * Compound root that groups a run of tool-call steps into a single "chain of
 * thought". While working it stays collapsed and the header shows the live
 * action on one line (icon + shimmering label) that transitions as steps
 * advance — the timeline never expands on its own. Once work ends the header
 * settles into a clickable "Thought process" accordion the user can open to
 * reveal the full step timeline.
 *
 * ```tsx
 * <ChainOfThought
 *   isWorking={anyRunning}
 *   activeStep={{ icon: WrenchIcon, label: "Canopy offer" }}
 * >
 *   <ChainOfThoughtHeader label="Thought process" />
 *   <ChainOfThoughtContent>
 *     <ChainOfThoughtStep icon={WrenchIcon} title="Getting you a quote" state="output-available" />
 *     <ChainOfThoughtStep icon={WrenchIcon} title="Canopy offer" state="output-available" isLast />
 *   </ChainOfThoughtContent>
 * </ChainOfThought>
 * ```
 */
export function ChainOfThought({
	className,
	isWorking = false,
	activeStep,
	open,
	defaultOpen = false,
	onOpenChange,
	children,
	...props
}: ChainOfThoughtProps) {
	const isControlled = open !== undefined;
	const [internalOpen, setInternalOpen] = useState(defaultOpen);
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

	// `settled` gates the header between its two modes. It starts true for a
	// chain that mounts already done (e.g. a historical message), flips false
	// the moment work starts, and latches true again a beat after work ends.
	const [settled, setSettled] = useState(!isWorking);

	useEffect(() => {
		if (isWorking) {
			setSettled(false);
			return;
		}
		const timer = setTimeout(() => setSettled(true), SETTLE_DELAY);
		return () => clearTimeout(timer);
	}, [isWorking]);

	const contextValue = useMemo<ChainContextValue>(
		() => ({ open: isOpen, setOpen, isWorking, settled, activeStep }),
		[isOpen, setOpen, isWorking, settled, activeStep],
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
	/** Fallback ticker label while working when no {@link ChainStep} is set
	 * (e.g. "Working on it…"). Falls back to `label`. */
	workingLabel?: string;
};

/**
 * The chain header, which renders in one of two modes:
 *
 * - **Working** (before the chain settles): a single, non-interactive line
 *   showing the active step — its icon plus a shimmering label. The label is
 *   keyed on its text so each new step animates in, giving a clean transition
 *   between tool calls. There is no chevron; the timeline stays collapsed.
 * - **Settled** (once work is done): a clickable "Thought process" accordion
 *   header with a trailing chevron that toggles the step timeline below.
 */
export function ChainOfThoughtHeader({
	className,
	label,
	workingLabel,
	children,
	...props
}: ChainOfThoughtHeaderProps) {
	const { open, setOpen, isWorking, settled, activeStep } = useChain();

	if (!settled) {
		const Icon = activeStep?.icon;
		const text = activeStep?.label ?? workingLabel ?? label ?? "";
		return (
			<div
				className={cn(
					"ww:flex ww:min-h-5 ww:w-full ww:items-center ww:gap-1.5 ww:text-sm ww:text-muted-foreground",
					className,
				)}
			>
				{/* Keyed on the label so a new action fades/slides in as one unit —
				    the "clean transition between tool calls". While work is live the
				    label shimmers; during the settle beat it holds static. */}
				<span
					key={text}
					className="ww:flex ww:min-w-0 ww:items-center ww:gap-1.5"
					style={{ animation: "ww-fade-in 0.25s ease-out" }}
				>
					{Icon && (
						<Icon
							className={cn(
								"ww:size-4 ww:shrink-0",
								isWorking && "ww:animate-pulse",
							)}
						/>
					)}
					<span className="ww:truncate">
						{isWorking ? <Shimmer duration={2.6}>{text}</Shimmer> : text}
					</span>
				</span>
			</div>
		);
	}

	return (
		<button
			type="button"
			onClick={() => setOpen(!open)}
			aria-expanded={open}
			className={cn(
				"ww:flex ww:min-h-5 ww:w-full ww:items-center ww:gap-1.5 ww:text-sm ww:text-muted-foreground ww:transition-colors ww:hover:text-foreground",
				className,
			)}
			style={{ animation: "ww-fade-in 0.25s ease-out" }}
			{...props}
		>
			<span className="ww:truncate">{children ?? label}</span>
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
