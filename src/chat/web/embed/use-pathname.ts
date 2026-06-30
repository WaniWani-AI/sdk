// ============================================================================
// usePathname — current `location.pathname`, reactive to SPA navigation.
//
// Customer sites with client-side routing change the URL via
// `history.pushState`/`replaceState` without a full page load, which fire no
// native event. We patch both (once, globally) to emit a custom event, and
// also listen to `popstate` (back/forward), so visibility gating re-evaluates
// on every route change — not just hard navigations.
// ============================================================================

import { useSyncExternalStore } from "react";
import { isVisibleForPath, type VisibilityRules } from "./visibility";

const LOCATION_CHANGE = "waniwani:locationchange";

let historyPatched = false;

/**
 * Patch `pushState`/`replaceState` to dispatch {@link LOCATION_CHANGE} after
 * the URL updates. Idempotent and left installed for the page's lifetime: it's
 * harmless, and multiple embed instances (or re-inits) can share it.
 */
function ensureHistoryPatched(): void {
	if (historyPatched || typeof history === "undefined") {
		return;
	}
	historyPatched = true;
	for (const method of ["pushState", "replaceState"] as const) {
		const original = history[method];
		history[method] = function patched(
			this: History,
			...args: Parameters<History["pushState"]>
		) {
			const result = original.apply(this, args);
			window.dispatchEvent(new Event(LOCATION_CHANGE));
			return result;
		};
	}
}

function subscribe(onChange: () => void): () => void {
	ensureHistoryPatched();
	window.addEventListener(LOCATION_CHANGE, onChange);
	window.addEventListener("popstate", onChange);
	return () => {
		window.removeEventListener(LOCATION_CHANGE, onChange);
		window.removeEventListener("popstate", onChange);
	};
}

function getSnapshot(): string {
	return window.location.pathname;
}

// Server snapshot — the embed never renders the dock during SSR, but the hook
// must be SSR-safe (no `window`). `/` is an inert placeholder.
function getServerSnapshot(): string {
	return "/";
}

/** Current `location.pathname`, re-rendering on client-side route changes. */
export function usePathname(): string {
	return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/**
 * Whether a chat surface should render on the current URL, given its channel's
 * `visibility` rules. Shared by every hosted surface (floating, inline,
 * `<WaniwaniChat>`) so per-URL gating behaves identically across them.
 *
 * Gating on `ready` is the no-flash guarantee: the surface is held back until
 * the remote config resolves (or the safety timer fires). On repeat visits the
 * `sessionStorage` config cache flips `ready` before the browser paints, so a
 * hidden page never shows the chat. Re-evaluates on SPA route changes via
 * {@link usePathname}.
 */
export function useVisibilityGate(
	rules: VisibilityRules | null | undefined,
	ready: boolean,
): boolean {
	const pathname = usePathname();
	return ready && isVisibleForPath(rules, pathname);
}
