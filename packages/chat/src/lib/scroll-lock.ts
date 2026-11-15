// ============================================================================
// Document scroll lock for the full-screen chat panel on phones.
//
// `overflow: hidden` on the page is not enough on iOS: Safari still scrolls
// the document when a touch starts on something that can't scroll, when a
// scroller is already at its edge, and while the keyboard is up. So besides
// the overflow rule, a capturing, non-passive `touchmove` listener cancels
// any one-finger drag that would move the page instead of a scroller inside
// the panel. Two-finger pinch is left alone, so the visitor can still zoom.
//
// The approach follows react-aria's `usePreventScroll`. Locks are counted,
// so two surfaces holding one at once release the page only when both let go.
// ============================================================================

let holders = 0;
let release: (() => void) | null = null;

/** Locks page scrolling. Returns the function that releases this hold. */
export function lockDocumentScroll(): () => void {
	if (typeof document === "undefined" || typeof window === "undefined") {
		return () => {};
	}
	holders += 1;
	if (holders === 1) {
		release = applyLock();
	}
	let released = false;
	return () => {
		if (released) {
			return;
		}
		released = true;
		holders -= 1;
		if (holders === 0) {
			release?.();
			release = null;
		}
	};
}

type Axis = "x" | "y";

function canScroll(el: Element, axis: Axis): boolean {
	const style = getComputedStyle(el);
	const overflow = axis === "y" ? style.overflowY : style.overflowX;
	if (overflow !== "auto" && overflow !== "scroll") {
		return false;
	}
	return axis === "y"
		? el.scrollHeight > el.clientHeight
		: el.scrollWidth > el.clientWidth;
}

/** Nearest element on the event path that scrolls along `axis`. */
function scrollerOnPath(path: EventTarget[], axis: Axis): Element | null {
	for (const node of path) {
		if (!(node instanceof Element)) {
			continue;
		}
		if (node === document.documentElement || node === document.body) {
			return null;
		}
		if (canScroll(node, axis)) {
			return node;
		}
	}
	return null;
}

/** Whether `el` has room to move for a finger travelling by `delta`. */
function hasRoom(el: Element, axis: Axis, delta: number): boolean {
	const position = axis === "y" ? el.scrollTop : el.scrollLeft;
	const max =
		axis === "y"
			? el.scrollHeight - el.clientHeight
			: el.scrollWidth - el.clientWidth;
	// A finger moving down (positive delta) scrolls toward the start.
	return delta > 0 ? position > 0 : position < max - 1;
}

function isRangeInput(path: EventTarget[]): boolean {
	return path.some(
		(node) => node instanceof HTMLInputElement && node.type === "range",
	);
}

function applyLock(): () => void {
	const html = document.documentElement;
	const previous = {
		overflow: html.style.overflow,
		overscroll: html.style.overscrollBehavior,
	};
	const scrollX = window.scrollX;
	const scrollY = window.scrollY;
	html.style.overflow = "hidden";
	html.style.overscrollBehavior = "none";

	let path: EventTarget[] = [];
	let lastX = 0;
	let lastY = 0;

	const onTouchStart = (event: TouchEvent) => {
		const touch = event.touches[0];
		if (event.touches.length !== 1 || !touch) {
			return;
		}
		// `composedPath` reaches into the widget's shadow root, where
		// `event.target` would stop at the host element.
		path = event
			.composedPath()
			.filter((node): node is EventTarget => node != null);
		lastX = touch.clientX;
		lastY = touch.clientY;
	};

	const onTouchMove = (event: TouchEvent) => {
		const touch = event.touches[0];
		if (!event.cancelable || event.touches.length !== 1 || !touch) {
			return;
		}
		if (isRangeInput(path)) {
			return;
		}
		const dx = touch.clientX - lastX;
		const dy = touch.clientY - lastY;
		lastX = touch.clientX;
		lastY = touch.clientY;
		const axis: Axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
		const scroller = scrollerOnPath(path, axis);
		if (!scroller || !hasRoom(scroller, axis, axis === "y" ? dy : dx)) {
			event.preventDefault();
		}
	};

	const options = { capture: true, passive: false } as const;
	document.addEventListener("touchstart", onTouchStart, options);
	document.addEventListener("touchmove", onTouchMove, options);

	return () => {
		document.removeEventListener("touchstart", onTouchStart, options);
		document.removeEventListener("touchmove", onTouchMove, options);
		html.style.overflow = previous.overflow;
		html.style.overscrollBehavior = previous.overscroll;
		// iOS scrolls the page to show a focused field even under the lock.
		// Put the visitor back where they were.
		if (window.scrollX !== scrollX || window.scrollY !== scrollY) {
			window.scrollTo(scrollX, scrollY);
		}
	};
}
