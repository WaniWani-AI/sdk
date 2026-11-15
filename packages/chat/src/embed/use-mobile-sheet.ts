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
//   - writes the visual viewport's height and top offset to
//     `--ww-vv-height` / `--ww-vv-top` on the panel, which the panel's CSS
//     uses for its size and position, so it always fills exactly the area
//     above the keyboard;
//   - sets `data-keyboard` on the panel while the keyboard is up, so the
//     bottom safe-area padding drops away (the keyboard covers that area);
//   - locks page scrolling (see `lib/scroll-lock.ts`).
// ============================================================================

import { type RefObject, useEffect } from "react";
import { lockDocumentScroll } from "../lib/scroll-lock";

/** A visual viewport this much shorter than the layout one means a keyboard. */
const KEYBOARD_THRESHOLD_PX = 120;

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

		const clear = () => {
			panel.style.removeProperty("--ww-vv-height");
			panel.style.removeProperty("--ww-vv-top");
			panel.removeAttribute("data-keyboard");
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
			panel.style.setProperty("--ww-vv-height", `${viewport.height}px`);
			panel.style.setProperty("--ww-vv-top", `${viewport.offsetTop}px`);
			const keyboard =
				window.innerHeight - viewport.height > KEYBOARD_THRESHOLD_PX;
			panel.toggleAttribute("data-keyboard", keyboard);
		};
		const schedule = () => {
			if (frame === 0) {
				frame = requestAnimationFrame(apply);
			}
		};

		apply();
		viewport.addEventListener("resize", schedule);
		viewport.addEventListener("scroll", schedule);
		window.addEventListener("resize", schedule);
		// iOS 26 can leave `offsetTop` above zero after the keyboard closes
		// until the next viewport event. Read it again once focus leaves.
		panel.addEventListener("focusout", schedule);

		return () => {
			if (frame !== 0) {
				cancelAnimationFrame(frame);
			}
			viewport.removeEventListener("resize", schedule);
			viewport.removeEventListener("scroll", schedule);
			window.removeEventListener("resize", schedule);
			panel.removeEventListener("focusout", schedule);
			clear();
		};
	}, [active, panelRef]);
}
