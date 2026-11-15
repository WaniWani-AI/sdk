// ============================================================================
// useTouchPrimary — "is a finger the main input on this device?"
//
// Phones and tablets without a trackpad match; a laptop with a touch screen
// does not, because its primary pointer is still fine and can hover. The chat
// reads this where touch needs different behavior, not only a different size:
// the Enter key in the composer.
// ============================================================================

import { useSyncExternalStore } from "react";

const TOUCH_QUERY = "(hover: none) and (pointer: coarse)";

function query(): MediaQueryList | null {
	if (
		typeof window === "undefined" ||
		typeof window.matchMedia !== "function"
	) {
		return null;
	}
	return window.matchMedia(TOUCH_QUERY);
}

/** Point-in-time read, for event handlers. */
export function isTouchPrimary(): boolean {
	return query()?.matches ?? false;
}

function subscribe(onChange: () => void): () => void {
	const mq = query();
	if (!mq) {
		return () => {};
	}
	mq.addEventListener("change", onChange);
	return () => mq.removeEventListener("change", onChange);
}

function getServerSnapshot(): boolean {
	return false;
}

/** `true` when the primary input is touch, re-rendering if that changes. */
export function useTouchPrimary(): boolean {
	return useSyncExternalStore(subscribe, isTouchPrimary, getServerSnapshot);
}
