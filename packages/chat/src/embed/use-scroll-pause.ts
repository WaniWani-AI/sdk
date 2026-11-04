import { useEffect, useRef } from "react";

const SECTION_SELECTOR = "section, [id]";

type Cancel = () => void;

export interface ScrollPauseOptions {
	pauseMs: number;
	onPause: (sectionKey: string) => void;
	sectionKeyAt?: () => string | null;
	schedule?: (run: () => void, ms: number) => Cancel;
}

function scheduleTimeout(run: () => void, ms: number): Cancel {
	const id = setTimeout(run, ms);
	return () => clearTimeout(id);
}

export function sectionKeyAtViewportCentre(doc: Document): string | null {
	const view = doc.defaultView;
	if (!view || typeof doc.elementFromPoint !== "function") {
		return null;
	}
	const section = doc
		.elementFromPoint(view.innerWidth / 2, view.innerHeight / 2)
		?.closest(SECTION_SELECTOR);
	if (!section) {
		return null;
	}
	if (section.id) {
		return section.id;
	}
	return String(
		Array.from(doc.querySelectorAll(SECTION_SELECTOR)).indexOf(section),
	);
}

/**
 * Calls `onPause` once per section, `pauseMs` after the last scroll event,
 * provided that scroll went down. Returns the teardown.
 */
export function watchScrollPause(
	target: Window,
	{
		pauseMs,
		onPause,
		sectionKeyAt = () => sectionKeyAtViewportCentre(target.document),
		schedule = scheduleTimeout,
	}: ScrollPauseOptions,
): Cancel {
	const seen = new Set<string>();
	let lastY = target.scrollY;
	let cancelPending: Cancel | null = null;

	const onScroll = () => {
		const y = target.scrollY;
		const wentDown = y > lastY;
		lastY = y;
		cancelPending?.();
		cancelPending = null;
		if (!wentDown) {
			return;
		}
		cancelPending = schedule(() => {
			cancelPending = null;
			const key = sectionKeyAt();
			if (key === null || seen.has(key)) {
				return;
			}
			seen.add(key);
			onPause(key);
		}, pauseMs);
	};

	target.addEventListener("scroll", onScroll, { passive: true });
	return () => {
		target.removeEventListener("scroll", onScroll);
		cancelPending?.();
	};
}

export function useScrollPause(
	enabled: boolean,
	pauseMs: number,
	onPause: (sectionKey: string) => void,
): void {
	const onPauseRef = useRef(onPause);
	onPauseRef.current = onPause;

	useEffect(() => {
		if (!enabled || typeof window === "undefined") {
			return;
		}
		return watchScrollPause(window, {
			pauseMs,
			onPause: (key) => onPauseRef.current(key),
		});
	}, [enabled, pauseMs]);
}
