import { useEffect, useRef } from "react";

function isPanelEntry(state: unknown): boolean {
	return (
		typeof state === "object" &&
		state !== null &&
		(state as { waniwaniPanel?: unknown }).waniwaniPanel === true
	);
}

/**
 * While `active`, holds a history entry so the back gesture calls `onBack`
 * instead of leaving the page. Deactivating pops the entry, but only when it
 * is still the current one.
 */
export function usePanelHistory(active: boolean, onBack: () => void): void {
	const onBackRef = useRef(onBack);
	onBackRef.current = onBack;

	// A flagged entry at mount was pushed before a reload; left flagged, it
	// would swallow the back that should close the next panel.
	useEffect(() => {
		if (typeof window === "undefined" || !window.history) {
			return;
		}
		const { history } = window;
		if (isPanelEntry(history.state)) {
			const { waniwaniPanel: _stale, ...hostState } = history.state as Record<
				string,
				unknown
			>;
			history.replaceState(hostState, "");
		}
	}, []);

	useEffect(() => {
		if (!active || typeof window === "undefined" || !window.history) {
			return;
		}
		const { history } = window;
		let entryIsOurs = true;
		// Keep the host router's own state on the entry, so stepping forward
		// onto it later reads as the same page to the router.
		const hostState =
			typeof history.state === "object" && history.state !== null
				? history.state
				: {};
		history.pushState({ ...hostState, waniwaniPanel: true }, "");

		const onPopState = (event: PopStateEvent) => {
			if (isPanelEntry(event.state)) {
				return;
			}
			entryIsOurs = false;
			onBackRef.current();
		};
		window.addEventListener("popstate", onPopState);

		return () => {
			window.removeEventListener("popstate", onPopState);
			if (entryIsOurs && isPanelEntry(history.state)) {
				history.back();
			}
		};
	}, [active]);
}
