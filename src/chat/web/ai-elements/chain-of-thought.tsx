"use client";

import type { ToolUIPart } from "ai";
import { BracesIcon, ChevronDownIcon } from "lucide-react";
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
import { Shimmer } from "./shimmer";

const AUTO_CLOSE_DELAY = 1000;

interface ChainContextValue {
	open: boolean;
	setOpen: (open: boolean) => void;
	isWorking: boolean;
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
 *   <ChainOfThoughtHeader count={steps.length} />
 *   <ChainOfThoughtContent>
 *     <ChainOfThoughtStep title="Getting you a quote" state="output-available" />
 *     <ChainOfThoughtStep title="Canopy offer" state="input-available" isLast />
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

	// Auto-open whenever work (re)starts; allow a fresh auto-close after.
	useEffect(() => {
		if (isWorking) {
			wasWorkingRef.current = true;
			setHasAutoClosed(false);
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

	const contextValue = useMemo<ChainContextValue>(
		() => ({ open: isOpen, setOpen, isWorking }),
		[isOpen, setOpen, isWorking],
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
	/** Label for the collapsed header — the title of the most recent step.
	 * The header tracks the latest step so it reads as a live continuation of
	 * the conversation rather than a generic summary. */
	label?: string;
};

/**
 * Clickable header that toggles the chain. Mirrors the most recent step's
 * title: it shimmers while that step runs, then settles on the last step's
 * title once everything's done — a contextual continuation of the
 * conversation, not a call to action (the chevron still expands for the
 * curious). Matches the {@link ToolHeader} / {@link ReasoningTrigger} style:
 * braces icon + muted text + chevron.
 */
export function ChainOfThoughtHeader({
	className,
	label,
	children,
	...props
}: ChainOfThoughtHeaderProps) {
	const { open, setOpen, isWorking } = useChain();
	const content =
		children ??
		(isWorking ? <Shimmer duration={1.6}>{label ?? ""}</Shimmer> : label);

	return (
		<button
			type="button"
			onClick={() => setOpen(!open)}
			aria-expanded={open}
			className={cn(
				"ww:flex ww:w-full ww:items-center ww:gap-2 ww:text-sm ww:text-muted-foreground ww:transition-colors ww:hover:text-foreground",
				className,
			)}
			{...props}
		>
			<BracesIcon className="ww:size-4 ww:shrink-0" />
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

export type ChainOfThoughtStepProps = HTMLAttributes<HTMLDivElement> & {
	title?: string;
	state: ToolUIPart["state"];
	/** When true, omits the connecting line below the dot (the timeline tail). */
	isLast?: boolean;
	/** Expandable detail (e.g. request/response JSON). When present the step
	 * row becomes a toggle. Omit for label-only ("titles-only") steps. */
	children?: ReactNode;
};

/**
 * A single step in the chain, rendered as a timeline node: a status dot with
 * a connecting line, plus the step title. While running the title shimmers.
 * If `children` are provided (full mode), the row toggles a collapsible panel
 * holding the tool request/response.
 */
export function ChainOfThoughtStep({
	className,
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
		<div className={cn("ww:flex ww:gap-3", className)} {...props}>
			{/* Timeline rail: dot + connecting line */}
			<div className="ww:flex ww:flex-col ww:items-center ww:self-stretch">
				<span
					className={cn(
						"ww:mt-[7px] ww:size-1.5 ww:shrink-0 ww:rounded-full",
						isError
							? "ww:bg-destructive"
							: isRunning
								? "ww:animate-pulse ww:bg-foreground"
								: "ww:bg-muted-foreground",
					)}
				/>
				{!isLast && <span className="ww:w-px ww:flex-1 ww:bg-border" />}
			</div>

			{/* Step body */}
			<div className={cn("ww:min-w-0 ww:flex-1", !isLast && "ww:pb-2")}>
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
