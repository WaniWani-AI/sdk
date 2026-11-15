// ============================================================================
// A light haptic tick on touch devices.
//
// The web has no haptics API on iOS. Android's Chrome has the Vibration API
// (`navigator.vibrate`). Safari 18 added the `switch` checkbox, and iOS plays
// its system tick when one toggles, so on iOS a hidden switch is clicked
// instead. That trick is undocumented behavior: Apple can drop it in any
// release, and then the call does nothing.
//
// Both paths only work inside a user gesture (a tap handler). Outside one,
// or with system haptics off, nothing happens and nothing throws.
// ============================================================================

import { isTouchPrimary } from "../hooks/use-touch-primary";

const VIBRATE_MS = 8;

export function hapticTick(): void {
	if (typeof document === "undefined" || !isTouchPrimary()) {
		return;
	}
	try {
		if (typeof navigator.vibrate === "function") {
			navigator.vibrate(VIBRATE_MS);
			return;
		}
		iosSwitchTick();
	} catch {
		// Haptics are decoration. A browser that refuses them changes nothing.
	}
}

function iosSwitchTick(): void {
	const label = document.createElement("label");
	label.setAttribute("aria-hidden", "true");
	label.style.display = "none";
	const input = document.createElement("input");
	input.type = "checkbox";
	input.setAttribute("switch", "");
	label.appendChild(input);
	document.head.appendChild(label);
	label.click();
	label.remove();
}
