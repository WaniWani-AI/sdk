// ============================================================================
// A light haptic tick on touch devices, through the Vibration API.
//
// Android browsers implement `navigator.vibrate`. Safari does not, and every
// browser on iOS runs on Safari's engine, so on an iPhone this does nothing.
// The call only takes effect inside a user gesture (a tap handler); outside
// one, or where the API is missing, nothing happens and nothing throws.
// ============================================================================

import { isTouchPrimary } from "../hooks/use-touch-primary";

const VIBRATE_MS = 8;

export function hapticTick(): void {
	if (
		typeof navigator === "undefined" ||
		typeof navigator.vibrate !== "function" ||
		!isTouchPrimary()
	) {
		return;
	}
	try {
		navigator.vibrate(VIBRATE_MS);
	} catch {
		// Haptics are decoration. A browser that refuses them changes nothing.
	}
}
