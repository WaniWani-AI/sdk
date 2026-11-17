// ============================================================================
// useMobileSheet — what the full-screen panel needs on a phone.
//
// On a phone the panel is `position: fixed` over the whole page. Fixed boxes
// follow the layout viewport, and the soft keyboard shrinks only the visual
// viewport (iOS Safari, and Chrome on Android by default). Left alone, the
// browser pans the page to show the focused field: the header slides off the
// top and the page moves behind the panel.
//
// While `active`, this hook:
//   - writes the keyboard's height to `--ww-keyboard-inset` and the visual
//     viewport's top offset to `--ww-vv-top` on the panel. The panel's CSS
//     keeps its background full height, under the keyboard, and pads its
//     content up by the inset, so the composer sits on the keyboard. The
//     iOS 26 keyboard, its form bar and Safari's address pill are translucent:
//     a panel that stopped at the keyboard let the host page show through them;
//   - sets `data-keyboard` on the panel while the keyboard is up. The keyboard
//     counts as up only while a text field has focus: iOS reports the new
//     viewport only once the keyboard has finished closing, sometimes seconds
//     later, so on blur the composer comes down at once (with
//     `data-keyboard-closing` for the slide) instead of waiting for it;
//   - focuses a tapped text field without Safari scrolling the page to it
//     (see `lib/focus-without-scroll.ts`), which made the sheet jump;
//   - locks page scrolling (see `lib/scroll-lock.ts`).
// ============================================================================

import { type RefObject, useEffect } from "react";
import { focusWithoutScroll, isTextField } from "../lib/focus-without-scroll";
import { lockDocumentScroll } from "../lib/scroll-lock";

/** A visual viewport this much shorter than the layout one means a keyboard. */
const KEYBOARD_THRESHOLD_PX = 120;

/** A touch that moved further than this was a scroll, not a tap. */
const TAP_SLOP_PX = 10;

/** How long `data-keyboard-closing` stays on; the CSS slide is shorter. */
const CLOSING_MS = 350;

/** The focused element, looking into the shadow root the panel lives in. */
function focusedIn(panel: HTMLElement): Element | null {
	const root = panel.getRootNode() as Document | ShadowRoot;
	return root.activeElement ?? null;
}

export function useMobileSheet(
	active: boolean,
	panelRef: RefObject<HTMLElement | null>,
): void {
	useEffect(() => {
		if (!active) {
			return;
		}
		return lockDocumentScroll();
	}, [active]);

	useEffect(() => {
		const panel = panelRef.current;
		const viewport =
			typeof window === "undefined" ? undefined : window.visualViewport;
		if (!active || !panel || !viewport) {
			return;
		}

		let lastInset = 0;
		let closingTimer: ReturnType<typeof setTimeout> | undefined;
		const clear = () => {
			clearTimeout(closingTimer);
			panel.style.removeProperty("--ww-keyboard-inset");
			panel.style.removeProperty("--ww-vv-top");
			panel.removeAttribute("data-keyboard");
			panel.removeAttribute("data-keyboard-closing");
		};

		let frame = 0;
		const apply = () => {
			frame = 0;
			// A pinch zoom also shrinks the visual viewport. Sizing the panel
			// to it would shrink the panel under the visitor's fingers, so a
			// zoomed page keeps the plain full-screen layout.
			if (Math.abs(viewport.scale - 1) > 0.01) {
				clear();
				return;
			}
			// No focused text field means no keyboard, whatever the viewport
			// still says while the keyboard closes.
			const typing = isTextField(focusedIn(panel));
			const inset = typing
				? Math.max(0, window.innerHeight - viewport.height)
				: 0;
			if (inset === 0 && lastInset > 0) {
				panel.setAttribute("data-keyboard-closing", "");
				clearTimeout(closingTimer);
				closingTimer = setTimeout(
					() => panel.removeAttribute("data-keyboard-closing"),
					CLOSING_MS,
				);
			}
			lastInset = inset;
			panel.style.setProperty("--ww-keyboard-inset", `${inset}px`);
			panel.style.setProperty("--ww-vv-top", `${viewport.offsetTop}px`);
			panel.toggleAttribute("data-keyboard", inset > KEYBOARD_THRESHOLD_PX);
		};
		const schedule = () => {
			if (frame === 0) {
				frame = requestAnimationFrame(apply);
			}
		};

		// A tap on a text field: focus it ourselves, without the page scroll.
		// Cancelling `touchend` stops the browser's own focus, which would
		// scroll. A touch that moved is a scroll of the thread and is left
		// alone.
		let startX = 0;
		let startY = 0;
		const onTouchStart = (event: TouchEvent) => {
			const touch = event.touches[0];
			if (touch) {
				startX = touch.clientX;
				startY = touch.clientY;
			}
		};
		const onTouchEnd = (event: TouchEvent) => {
			const target = event.composedPath()[0] ?? null;
			const touch = event.changedTouches[0];
			if (!isTextField(target) || !touch || !event.cancelable) {
				return;
			}
			const root = target.getRootNode() as Document | ShadowRoot;
			if (root.activeElement === target) {
				return;
			}
			const moved =
				Math.abs(touch.clientX - startX) > TAP_SLOP_PX ||
				Math.abs(touch.clientY - startY) > TAP_SLOP_PX;
			if (moved) {
				return;
			}
			event.preventDefault();
			focusWithoutScroll(target);
		};

		apply();
		viewport.addEventListener("resize", schedule);
		viewport.addEventListener("scroll", schedule);
		window.addEventListener("resize", schedule);
		// Focus leaving a field closes the keyboard; focus arriving opens it.
		// Both re-read the layout in the next frame, once focus has settled.
		panel.addEventListener("focusout", schedule);
		panel.addEventListener("focusin", schedule);
		panel.addEventListener("touchstart", onTouchStart, { passive: true });
		panel.addEventListener("touchend", onTouchEnd);

		return () => {
			if (frame !== 0) {
				cancelAnimationFrame(frame);
			}
			viewport.removeEventListener("resize", schedule);
			viewport.removeEventListener("scroll", schedule);
			window.removeEventListener("resize", schedule);
			panel.removeEventListener("focusout", schedule);
			panel.removeEventListener("focusin", schedule);
			panel.removeEventListener("touchstart", onTouchStart);
			panel.removeEventListener("touchend", onTouchEnd);
			clear();
		};
	}, [active, panelRef]);
}
