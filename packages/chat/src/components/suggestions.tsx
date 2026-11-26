"use client";

import {
	type CSSProperties,
	type HTMLAttributes,
	useEffect,
	useRef,
	useState,
} from "react";
import type { SuggestionOrigin } from "../lib/resolve-suggestions";
import { cn } from "../lib/utils";
import { PARTS } from "../parts";

export interface SuggestionsProps
	extends Omit<HTMLAttributes<HTMLDivElement>, "onSelect"> {
	suggestions: string[];
	isLoading?: boolean;
	onSelect: (suggestion: string) => void;
	/** Horizontal alignment of the pills while they fit. Defaults to `"start"`. */
	align?: "start" | "center";
	origin?: SuggestionOrigin | "welcome" | "dock";
	/**
	 * @deprecated No effect: the row is always one line that scrolls sideways.
	 * Still stamped as `data-layout` for host CSS. Removed in 2.0.0.
	 */
	layout?: "wrap" | "single-row";
}

/** Which ends of the row have pills scrolled out of view. */
interface Overflow {
	start: boolean;
	end: boolean;
}

/**
 * Tracks which ends of a sideways scroller hide content, and turns a vertical
 * mouse wheel into a sideways scroll while the row can still move that way.
 * At either end the wheel falls through, so the page keeps scrolling.
 *
 * `content` is a key for the pill set: the row mounts only once there are
 * pills, and a new set starts back at the first pill. A string, so a parent
 * that rebuilds an equal array on every render does not reset the scroll.
 */
function useScrollRow(content: string) {
	const ref = useRef<HTMLDivElement>(null);
	const [overflow, setOverflow] = useState<Overflow>({
		start: false,
		end: false,
	});

	// biome-ignore lint/correctness/useExhaustiveDependencies: re-attach when the pill set changes
	useEffect(() => {
		const el = ref.current;
		if (!el) {
			return;
		}
		const update = () => {
			const start = el.scrollLeft > 1;
			const end = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
			setOverflow((prev) =>
				prev.start === start && prev.end === end ? prev : { start, end },
			);
		};
		const onWheel = (e: WheelEvent) => {
			if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) {
				return;
			}
			const atStart = el.scrollLeft <= 0;
			const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1;
			if ((e.deltaY < 0 && atStart) || (e.deltaY > 0 && atEnd)) {
				return;
			}
			e.preventDefault();
			el.scrollLeft += e.deltaY;
		};
		el.scrollLeft = 0;
		update();
		el.addEventListener("scroll", update, { passive: true });
		el.addEventListener("wheel", onWheel, { passive: false });
		const observer =
			typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
		observer?.observe(el);
		return () => {
			el.removeEventListener("scroll", update);
			el.removeEventListener("wheel", onWheel);
			observer?.disconnect();
		};
	}, [content]);

	return { ref, overflow };
}

/**
 * The suggestion row: one line of pills that scrolls sideways, whatever the
 * count. A pill is as wide as its label, up to the width of the row, so a
 * label only ends in an ellipsis when it is wider than the input. An edge
 * fades while pills are scrolled past it.
 */
export function Suggestions({
	suggestions,
	isLoading,
	onSelect,
	align = "start",
	origin,
	layout,
	className,
	...props
}: SuggestionsProps) {
	const row = useScrollRow(
		isLoading ? "\u0000loading" : suggestions.join("\u0000"),
	);

	if (suggestions.length === 0 && !isLoading) {
		return null;
	}

	// `ms-auto` on the first pill and `me-auto` on the last centre the pills
	// while they fit and fall back to the start once they overflow, which
	// `justify-content: center` cannot do in a scroller.
	const centered = align === "center" && "ww:first:ms-auto ww:last:me-auto";

	return (
		<div
			className={cn(PARTS.suggestions, "ww:px-4 ww:py-2", className)}
			data-layout={layout}
			data-origin={origin}
			{...props}
		>
			<div className="ww:mx-auto ww:w-full ww:max-w-[var(--ww-content-max-width)]">
				<div
					ref={row.ref}
					className="ww-suggestions-row ww:-mx-1 ww:flex ww:gap-2 ww:overflow-x-auto ww:px-1 ww:py-0.5 ww:scroll-px-1 ww:pointer-coarse:snap-x ww:pointer-coarse:snap-mandatory"
					data-overflow-start={row.overflow.start ? "" : undefined}
					data-overflow-end={row.overflow.end ? "" : undefined}
				>
					{isLoading
						? [0, 1, 2].map((i) => (
								<div
									key={i}
									className={cn(
										"ww:h-8 ww:shrink-0 ww:rounded-full ww:bg-accent ww:animate-pulse",
										centered,
									)}
									style={{ width: `${60 + i * 20}px` }}
								/>
							))
						: suggestions.map((suggestion, index) => (
								<button
									key={suggestion}
									type="button"
									title={suggestion}
									onClick={() => onSelect(suggestion)}
									data-origin={origin}
									data-index={index}
									className={cn(
										PARTS.suggestion,
										// `bg-accent`, not `bg-background`: inside the open panel the
										// pills sit on the background color itself, where a
										// background-filled pill with a hairline border is
										// indistinguishable from plain text.
										"ww:rounded-[var(--ww-suggestion-radius)] ww:border ww:border-[color:var(--ww-suggestion-border)] ww:bg-[color:var(--ww-suggestion-bg)] ww:px-3.5 ww:py-1.5 ww:text-sm",
										"ww:text-[color:var(--ww-suggestion-fg)] ww:hover:bg-[color:var(--ww-suggestion-hover-bg)] ww:hover:border-primary/30",
										"ww:shrink-0 ww:max-w-full ww:overflow-hidden ww:text-ellipsis ww:whitespace-nowrap ww:text-left ww:pointer-coarse:snap-start",
										"ww:transition-colors ww:duration-200 ww:ease-out ww:cursor-pointer",
										centered,
									)}
									style={{ "--ww-index": index } as CSSProperties}
								>
									{suggestion}
								</button>
							))}
				</div>
			</div>
		</div>
	);
}
