"use client";

import { BrainIcon, ChevronDownIcon } from "lucide-react";
import type { HTMLAttributes, ReactNode } from "react";
import {
	createContext,
	memo,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { Streamdown } from "streamdown";
import { cn } from "../lib/utils";
import { Shimmer } from "./shimmer";

interface ReasoningContextValue {
	isStreaming: boolean;
	isOpen: boolean;
	setIsOpen: (open: boolean) => void;
	duration: number | undefined;
}

const ReasoningContext = createContext<ReasoningContextValue | null>(null);

function useReasoning(): ReasoningContextValue {
	const ctx = useContext(ReasoningContext);
	if (!ctx) {
		throw new Error("Reasoning components must be used within <Reasoning>");
	}
	return ctx;
}

const AUTO_CLOSE_DELAY = 1000;
const MS_IN_S = 1000;

export type ReasoningProps = HTMLAttributes<HTMLDivElement> & {
	isStreaming?: boolean;
	open?: boolean;
	defaultOpen?: boolean;
	onOpenChange?: (open: boolean) => void;
	duration?: number;
};

/**
 * Compound root for a model's reasoning trace. Tracks streaming duration,
 * auto-opens during streaming, auto-collapses ~1s after streaming ends.
 *
 * ```tsx
 * <Reasoning isStreaming={part.state === "streaming"}>
 *   <ReasoningTrigger />
 *   <ReasoningContent>{part.text}</ReasoningContent>
 * </Reasoning>
 * ```
 */
export const Reasoning = memo(
	({
		className,
		isStreaming = false,
		open,
		defaultOpen,
		onOpenChange,
		duration: durationProp,
		children,
		...props
	}: ReasoningProps) => {
		const resolvedDefaultOpen = defaultOpen ?? isStreaming;
		const isExplicitlyClosed = defaultOpen === false;

		const isControlled = open !== undefined;
		const [internalOpen, setInternalOpen] = useState(resolvedDefaultOpen);
		const isOpen = isControlled ? open : internalOpen;
		const setIsOpen = useCallback(
			(next: boolean) => {
				if (!isControlled) {
					setInternalOpen(next);
				}
				onOpenChange?.(next);
			},
			[isControlled, onOpenChange],
		);

		const [internalDuration, setInternalDuration] = useState<
			number | undefined
		>(undefined);
		const duration = durationProp ?? internalDuration;

		const hasEverStreamedRef = useRef(isStreaming);
		const [hasAutoClosed, setHasAutoClosed] = useState(false);
		const startTimeRef = useRef<number | null>(null);

		// Track streaming start/end → compute duration.
		useEffect(() => {
			if (isStreaming) {
				hasEverStreamedRef.current = true;
				if (startTimeRef.current === null) {
					startTimeRef.current = Date.now();
				}
			} else if (startTimeRef.current !== null) {
				setInternalDuration(
					Math.ceil((Date.now() - startTimeRef.current) / MS_IN_S),
				);
				startTimeRef.current = null;
			}
		}, [isStreaming]);

		// Auto-open on streaming start.
		useEffect(() => {
			if (isStreaming && !isOpen && !isExplicitlyClosed) {
				setIsOpen(true);
			}
		}, [isStreaming, isOpen, isExplicitlyClosed, setIsOpen]);

		// Auto-close ~1s after streaming ends (once).
		useEffect(() => {
			if (
				hasEverStreamedRef.current &&
				!isStreaming &&
				isOpen &&
				!hasAutoClosed
			) {
				const timer = setTimeout(() => {
					setIsOpen(false);
					setHasAutoClosed(true);
				}, AUTO_CLOSE_DELAY);
				return () => clearTimeout(timer);
			}
		}, [isStreaming, isOpen, hasAutoClosed, setIsOpen]);

		const contextValue = useMemo<ReasoningContextValue>(
			() => ({ isStreaming, isOpen, setIsOpen, duration }),
			[isStreaming, isOpen, setIsOpen, duration],
		);

		return (
			<ReasoningContext.Provider value={contextValue}>
				<div
					className={cn("ww:mb-4 ww:flex ww:flex-col ww:gap-2", className)}
					data-state={isOpen ? "open" : "closed"}
					style={{ animation: "ww-fade-in 0.2s ease-out" }}
					{...props}
				>
					{children}
				</div>
			</ReasoningContext.Provider>
		);
	},
);
Reasoning.displayName = "Reasoning";

export type ReasoningTriggerProps = HTMLAttributes<HTMLButtonElement> & {
	getThinkingMessage?: (isStreaming: boolean, duration?: number) => ReactNode;
};

const defaultGetThinkingMessage = (
	isStreaming: boolean,
	duration?: number,
): ReactNode => {
	if (isStreaming || duration === 0) {
		return <Shimmer duration={1.6}>Thinking…</Shimmer>;
	}
	if (duration === undefined) {
		return <span>Thought for a few seconds</span>;
	}
	return (
		<span>
			Thought for {duration} second{duration === 1 ? "" : "s"}
		</span>
	);
};

export const ReasoningTrigger = memo(
	({
		className,
		children,
		getThinkingMessage = defaultGetThinkingMessage,
		onClick,
		...props
	}: ReasoningTriggerProps) => {
		const { isStreaming, isOpen, duration, setIsOpen } = useReasoning();

		return (
			<button
				type="button"
				aria-expanded={isOpen}
				onClick={(e) => {
					setIsOpen(!isOpen);
					onClick?.(e);
				}}
				className={cn(
					"ww:flex ww:w-full ww:items-center ww:gap-2 ww:text-sm ww:text-muted-foreground ww:transition-colors ww:hover:text-foreground",
					className,
				)}
				{...props}
			>
				{children ?? (
					<>
						<BrainIcon className="ww:size-4 ww:shrink-0" />
						{getThinkingMessage(isStreaming, duration)}
						<ChevronDownIcon
							className={cn(
								"ww:size-4 ww:shrink-0 ww:transition-transform ww:duration-200",
								isOpen && "ww:rotate-180",
							)}
						/>
					</>
				)}
			</button>
		);
	},
);
ReasoningTrigger.displayName = "ReasoningTrigger";

export type ReasoningContentProps = HTMLAttributes<HTMLDivElement> & {
	children: string;
};

export const ReasoningContent = memo(
	({ className, children, ...props }: ReasoningContentProps) => {
		const { isOpen } = useReasoning();
		return (
			<div
				className={cn(
					"ww:grid ww:transition-[grid-template-rows,opacity] ww:duration-200 ww:ease-out",
					isOpen
						? "ww:grid-rows-[1fr] ww:opacity-100"
						: "ww:grid-rows-[0fr] ww:opacity-0",
				)}
			>
				<div className="ww:min-h-0 ww:overflow-hidden">
					<div
						className={cn("ww:text-sm ww:text-muted-foreground", className)}
						{...props}
					>
						<Streamdown>{children}</Streamdown>
					</div>
				</div>
			</div>
		);
	},
);
ReasoningContent.displayName = "ReasoningContent";
