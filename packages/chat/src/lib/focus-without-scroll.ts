// ============================================================================
// Focus a text field without iOS Safari scrolling the page to it.
//
// When a field takes focus, Safari scrolls the page so the field sits above
// the keyboard it is about to raise, and `preventScroll` does not stop that.
// Inside the full-screen chat panel the scroll is wrong: the panel is fixed,
// so the whole sheet jumps up, then jumps back once the panel follows the
// visual viewport. Moving the field 2000px up for the focus call makes Safari
// see it as already in view, so it scrolls nothing. The transform comes off
// in the next frame, before anything paints.
//
// This is how react-aria's `usePreventScroll` handles the same problem.
// ============================================================================

const OFF_SCREEN = "translateY(-2000px)";

export function focusWithoutScroll(el: HTMLElement): void {
	const previous = el.style.transform;
	el.style.transform = OFF_SCREEN;
	el.focus({ preventScroll: true });
	requestAnimationFrame(() => {
		el.style.transform = previous;
	});
}

/** Text fields that raise a soft keyboard when focused. */
export function isTextField(node: EventTarget | null): node is HTMLElement {
	if (node instanceof HTMLTextAreaElement) {
		return !node.readOnly && !node.disabled;
	}
	if (node instanceof HTMLInputElement) {
		const noKeyboard = [
			"button",
			"checkbox",
			"color",
			"file",
			"hidden",
			"image",
			"radio",
			"range",
			"reset",
			"submit",
		];
		return !noKeyboard.includes(node.type) && !node.readOnly && !node.disabled;
	}
	return node instanceof HTMLElement && node.isContentEditable;
}
