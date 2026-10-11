// ============================================================================
// useNearPageBottom — reactive "the visitor has reached the page footer".
//
// The floating dock is pinned to the viewport, so at the very bottom of a page
// it sits on top of the host's footer (legal links, contact details). With
// `hideAtBottom` set, the dock slides away once the visitor scrolls within
// `threshold` px of the end of the document and slides back in as soon as they
// scroll up again.
//
// A passive scroll/resize listener, coalesced to one read per animation frame,
// does the work. We don't inject a sentinel element into the host DOM: the
// embed lives in a shadow root and shouldn't touch the page's own markup.
// ============================================================================

import { useEffect, useState } from "react";

/** Default distance (px) from the document end at which the dock hides. */
export const DEFAULT_HIDE_AT_BOTTOM_PX = 120;

/**
 * Extra distance (px) the visitor has to scroll back up before the dock
 * returns, so scrolling right at the boundary doesn't flicker it.
 */
const HYSTERESIS_PX = 48;

export interface ScrollMetrics {
	scrollY: number;
	viewportHeight: number;
	documentHeight: number;
}

/**
 * Pure decision step, split out for tests. `wasNear` is the previous answer,
 * which picks the side of the hysteresis band to measure against.
 *
 * A page that doesn't scroll at all is never "near the bottom": the visitor
 * can't scroll the dock back into view there, so hiding it would hide it for
 * good.
 */
export function isNearPageBottom(
	{ scrollY, viewportHeight, documentHeight }: ScrollMetrics,
	threshold: number,
	wasNear: boolean,
): boolean {
	if (documentHeight <= viewportHeight + 1) {
		return false;
	}
	const remaining = documentHeight - (scrollY + viewportHeight);
	return remaining <= (wasNear ? threshold + HYSTERESIS_PX : threshold);
}

function readMetrics(): ScrollMetrics {
	const doc = document.documentElement;
	return {
		scrollY: window.scrollY ?? doc.scrollTop ?? 0,
		viewportHeight: window.innerHeight ?? doc.clientHeight ?? 0,
		documentHeight: Math.max(
			doc.scrollHeight ?? 0,
			document.body?.scrollHeight ?? 0,
		),
	};
}

/**
 * Whether the visitor is within `threshold` px of the end of the page.
 * `null` threshold turns the hook off and it always reports `false`.
 */
export function useNearPageBottom(threshold: number | null): boolean {
	const [near, setNear] = useState(false);

	useEffect(() => {
		if (threshold === null || typeof window === "undefined") {
			setNear(false);
			return;
		}

		let current = false;
		let frame: number | null = null;

		const evaluate = () => {
			frame = null;
			const next = isNearPageBottom(readMetrics(), threshold, current);
			if (next !== current) {
				current = next;
				setNear(next);
			}
		};
		const schedule = () => {
			if (frame === null) {
				frame = window.requestAnimationFrame(evaluate);
			}
		};

		evaluate();
		window.addEventListener("scroll", schedule, { passive: true });
		window.addEventListener("resize", schedule, { passive: true });
		return () => {
			window.removeEventListener("scroll", schedule);
			window.removeEventListener("resize", schedule);
			if (frame !== null) {
				window.cancelAnimationFrame(frame);
			}
		};
	}, [threshold]);

	return near;
}
