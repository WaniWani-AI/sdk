// ============================================================================
// useNearPageBottom — reactive "the visitor has reached the page footer".
//
// The floating dock is pinned to the viewport, so at the end of a page it sits
// on top of the host's footer (legal links, contact details). By default the
// dock slides away as soon as the page's footer scrolls into view and slides
// back once the visitor scrolls up again. Pages without a recognisable footer
// fall back to "within 120px of the end of the document". A numeric
// `hideAtBottom` skips footer detection and uses that distance instead.
//
// A passive scroll/resize listener, coalesced to one read per animation frame,
// does the work. We don't inject a sentinel element into the host DOM: the
// embed lives in a shadow root and shouldn't touch the page's own markup.
// ============================================================================

import { useEffect, useState } from "react";

/** Distance (px) from the document end used when the page has no footer. */
export const DEFAULT_HIDE_AT_BOTTOM_PX = 120;

/**
 * Extra distance (px) the visitor has to scroll back up before the dock
 * returns, so scrolling right at the boundary doesn't flicker it.
 */
const HYSTERESIS_PX = 48;

/** What the dock hides against: the page footer, or a fixed distance. */
export type BottomTrigger = "footer" | number;

export interface ScrollMetrics {
	scrollY: number;
	viewportHeight: number;
	documentHeight: number;
	/** Top edge of the page footer relative to the viewport, if one was found. */
	footerTop: number | null;
}

/**
 * Pure decision step, split out for tests. `wasNear` is the previous answer,
 * which picks the side of the hysteresis band to measure against.
 *
 * The dock only hides once the visitor has scrolled. On a page that loads
 * with its footer already in view (or that doesn't scroll at all) the visitor
 * couldn't scroll the dock back, so hiding it would hide it for good.
 */
export function isNearPageBottom(
	{ scrollY, viewportHeight, documentHeight, footerTop }: ScrollMetrics,
	trigger: BottomTrigger,
	wasNear: boolean,
): boolean {
	if (scrollY <= 0 || documentHeight <= viewportHeight + 1) {
		return false;
	}
	const band = wasNear ? HYSTERESIS_PX : 0;
	if (trigger === "footer" && footerTop !== null) {
		return footerTop < viewportHeight + band;
	}
	const threshold =
		typeof trigger === "number" ? trigger : DEFAULT_HIDE_AT_BOTTOM_PX;
	const remaining = documentHeight - (scrollY + viewportHeight);
	return remaining <= threshold + band;
}

/**
 * The page's own footer: the last `<footer>` / `[role="contentinfo"]` in the
 * document, so article or card footers earlier in the page don't count.
 * Fixed and sticky footers are skipped since they're always on screen and
 * would keep the dock hidden.
 */
export function findPageFooter(doc: Document): Element | null {
	const candidates = doc.querySelectorAll('footer, [role="contentinfo"]');
	for (let i = candidates.length - 1; i >= 0; i--) {
		const el = candidates[i];
		if (!el) {
			continue;
		}
		const position = doc.defaultView?.getComputedStyle(el).position;
		if (position !== "fixed" && position !== "sticky") {
			return el;
		}
	}
	return null;
}

/**
 * Whether the visitor has reached the bottom of the page. `null` turns the
 * hook off and it always reports `false`.
 */
export function useNearPageBottom(trigger: BottomTrigger | null): boolean {
	const [near, setNear] = useState(false);

	useEffect(() => {
		if (trigger === null || typeof window === "undefined") {
			setNear(false);
			return;
		}

		let current = false;
		let frame: number | null = null;
		let footer: Element | null = null;

		const readMetrics = (): ScrollMetrics => {
			const doc = document.documentElement;
			if (trigger === "footer" && !footer?.isConnected) {
				// Re-resolved lazily: SPA navigations swap the footer out.
				footer = findPageFooter(document);
			}
			return {
				scrollY: window.scrollY ?? doc.scrollTop ?? 0,
				viewportHeight: window.innerHeight ?? doc.clientHeight ?? 0,
				documentHeight: Math.max(
					doc.scrollHeight ?? 0,
					document.body?.scrollHeight ?? 0,
				),
				footerTop: footer ? footer.getBoundingClientRect().top : null,
			};
		};

		const evaluate = () => {
			frame = null;
			const next = isNearPageBottom(readMetrics(), trigger, current);
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
	}, [trigger]);

	return near;
}
