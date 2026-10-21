// ============================================================================
// useNarrowViewport — "is this a phone-width viewport?"
//
// 639px is not arbitrary: it is one below Tailwind's `sm` breakpoint, which is
// where every chat surface already switches between its phone and desktop
// presentation (the panel goes from a centered card to a full-screen sheet at
// exactly this line). Components that need the same split in JS rather than in
// CSS read it here, so the two can't drift apart.
// ============================================================================

import { useSyncExternalStore } from "react";

/** One below Tailwind's `sm` (640px), matching the widget's own `sm:` rules. */
const NARROW_QUERY = "(max-width: 639px)";

function subscribe(onChange: () => void): () => void {
	const mq = window.matchMedia(NARROW_QUERY);
	mq.addEventListener("change", onChange);
	return () => mq.removeEventListener("change", onChange);
}

function getSnapshot(): boolean {
	return window.matchMedia(NARROW_QUERY).matches;
}

// Server snapshot. Desktop is the safe default: it renders the full input, so
// a hydration pass that corrects to `true` swaps in the simpler surface rather
// than the other way round.
function getServerSnapshot(): boolean {
	return false;
}

/**
 * `true` on phone-width viewports, re-rendering when the viewport crosses the
 * breakpoint (rotation, a resized desktop window, a devtools viewport change).
 */
export function useNarrowViewport(): boolean {
	return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
