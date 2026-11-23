// ============================================================================
// useInViewOnce — latches `true` the first time an element is on screen.
//
// The composer sits in the page flow, often below the fold, so an entrance
// that plays on mount would be over before the visitor scrolls to it. This
// reports the moment the box is actually in view, and stays `true` after that:
// the entrance plays once per mount, not on every scroll back.
//
// A negative bottom `rootMargin` and a partial threshold wait until the box is
// a little way into the viewport, so the motion happens where the eye is
// rather than at the very bottom edge. Without IntersectionObserver the hook
// reports `true` at once, so the composer is never stuck invisible.
// ============================================================================

import { type RefObject, useEffect, useState } from "react";

/** Share of the box that must be visible before it counts as on screen. */
const THRESHOLD = 0.25;

/** Shrinks the viewport's bottom edge, so the box is clearly in view. */
const ROOT_MARGIN = "0px 0px -8% 0px";

/**
 * Whether `ref`'s element has been on screen since `enabled` first turned
 * `true`. Never flips back to `false`.
 */
export function useInViewOnce(
	ref: RefObject<Element | null>,
	enabled: boolean,
): boolean {
	const [seen, setSeen] = useState(false);

	useEffect(() => {
		if (seen || !enabled) {
			return;
		}
		const el = ref.current;
		if (!el || typeof IntersectionObserver === "undefined") {
			setSeen(true);
			return;
		}
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) {
					setSeen(true);
					observer.disconnect();
				}
			},
			{ threshold: THRESHOLD, rootMargin: ROOT_MARGIN },
		);
		observer.observe(el);
		return () => observer.disconnect();
	}, [ref, enabled, seen]);

	return seen;
}
