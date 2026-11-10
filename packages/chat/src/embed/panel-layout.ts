import type { PanelLayout } from "./config";

// The chat panel that the floating bar and the composer open. Both surfaces
// render the same element (`data-waniwani-floating="panel"`), so its frame
// lives here once. The open/close motion is in `tailwind.css`, keyed on
// `data-layout`.

/** Classes every layout shares. Phones get a full-screen sheet. */
const BASE =
	"ww:fixed ww:z-[var(--ww-z-index)] ww:flex ww:flex-col ww:overflow-hidden ww:bg-background ww:inset-0 ww:w-full ww:rounded-none";

const DESKTOP: Record<PanelLayout, string> = {
	// Wide ChatGPT-style card. Message content and input both stay capped at
	// max-w-3xl and centered, so the extra panel width reads as side padding.
	modal:
		"ww:sm:inset-auto ww:sm:bottom-[var(--ww-panel-offset)] ww:sm:left-0 ww:sm:right-0 ww:sm:mx-auto ww:sm:h-[var(--ww-panel-height)] ww:sm:max-h-[calc(100dvh-var(--ww-panel-offset)*2)] ww:sm:w-[calc(100vw-var(--ww-panel-offset)*2)] ww:sm:max-w-[var(--ww-panel-width)] ww:sm:rounded-[var(--ww-panel-radius)] ww:sm:border ww:sm:border-border",
	// Full-height column on the right edge, over the page.
	sidebar:
		"ww:sm:left-auto ww:sm:w-[var(--ww-sidebar-width)] ww:sm:max-w-full ww:sm:border-l ww:sm:border-border",
};

export function panelLayoutOf(layout: PanelLayout | undefined): PanelLayout {
	return layout === "sidebar" ? "sidebar" : "modal";
}

export function panelClassName(layout: PanelLayout): string {
	return `${BASE} ${DESKTOP[layout]}`;
}
