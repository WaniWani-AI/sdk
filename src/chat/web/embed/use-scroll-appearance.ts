// ============================================================================
// useScrollAppearance — reactive "appear after scrolling past an element".
//
// Given a CSS selector on the host page, reports whether the floating bar
// should be revealed: hidden while the target element is in (or below) the
// viewport, shown once it's scrolled above the top. Reactive on purpose — the
// bar hides again on the way back up, so it never re-collides with the element
// it was told to clear (e.g. a hero card).
//
// A single IntersectionObserver does the work. A small bottom `rootMargin`
// adds hysteresis so the trigger doesn't thrash right at the element's edge.
// If the selector matches nothing (typo, or host markup that never renders),
// we fail *open* after a short grace period — showing the bar beats hiding it
// forever on a bad selector.
// ============================================================================

import { useEffect, useState } from "react";

/** Give the host page this long to render the target before failing open. */
const ELEMENT_LOOKUP_TIMEOUT_MS = 3000;

/** Poll interval while waiting for the target element to appear in the DOM. */
const ELEMENT_POLL_INTERVAL_MS = 120;

/**
 * Hysteresis band (px) at the element's bottom edge, so scrolling across the
 * boundary doesn't flip the bar on and off repeatedly.
 */
const HYSTERESIS_PX = 24;

/**
 * Whether the bar should be revealed on the current path, given an "appear
 * after" CSS selector. `null` selector → always `false` (the caller uses the
 * default timer instead). Re-evaluates whenever the selector changes.
 */
export function useScrollAppearance(selector: string | null): boolean {
	const [appeared, setAppeared] = useState(false);

	useEffect(() => {
		if (!selector || typeof document === "undefined") {
			setAppeared(false);
			return;
		}

		let cancelled = false;
		let observer: IntersectionObserver | null = null;
		let pollId: ReturnType<typeof setTimeout> | null = null;
		let failOpenId: ReturnType<typeof setTimeout> | null = null;

		const observe = (el: Element) => {
			observer = new IntersectionObserver(
				(entries) => {
					const entry = entries[0];
					if (!entry) {
						return;
					}
					// In view → keep the bar back so it doesn't overlap the element.
					// Out of view → reveal only once scrolled *past* it (its bottom is
					// above the viewport top), not while it's still below the fold.
					setAppeared(
						!entry.isIntersecting && entry.boundingClientRect.bottom <= 0,
					);
				},
				{ rootMargin: `0px 0px -${HYSTERESIS_PX}px 0px`, threshold: 0 },
			);
			observer.observe(el);
		};

		const find = () => {
			if (cancelled) {
				return;
			}
			let el: Element | null = null;
			try {
				el = document.querySelector(selector);
			} catch {
				// Invalid selector — fail open immediately rather than retry-then-hide.
				setAppeared(true);
				return;
			}
			if (el) {
				observe(el);
				return;
			}
			pollId = setTimeout(find, ELEMENT_POLL_INTERVAL_MS);
		};

		find();
		failOpenId = setTimeout(() => {
			if (cancelled || observer) {
				return;
			}
			// Never found the element — show the bar rather than hide it forever.
			if (pollId) {
				clearTimeout(pollId);
			}
			setAppeared(true);
		}, ELEMENT_LOOKUP_TIMEOUT_MS);

		return () => {
			cancelled = true;
			observer?.disconnect();
			if (pollId) {
				clearTimeout(pollId);
			}
			if (failOpenId) {
				clearTimeout(failOpenId);
			}
		};
	}, [selector]);

	return appeared;
}
