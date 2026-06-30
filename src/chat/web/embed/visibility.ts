// ============================================================================
// Per-URL visibility matching for the floating embed.
//
// Consumes the per-channel `visibility` rules from the remote `/config`
// response and decides whether the floating dock should render on the current
// `window.location.pathname`.
//
// Dependency-free on purpose: the embed ships as a single IIFE and bundle size
// matters, so we don't pull in `picomatch`/`minimatch`. The glob dialect is
// intentionally tiny — see `globToRegExp`.
// ============================================================================

/**
 * Per-channel visibility rules. Mirrors the app-side `visibility` JSONB shape
 * (WAN-516). Semantics: show on all pages by default, override per-URL.
 */
export interface VisibilityRules {
	/** Action when no pattern matches the current path. */
	default: "show" | "hide";
	/** Glob patterns evaluated against `window.location.pathname`, in order. */
	patterns: { glob: string; action: "show" | "hide" }[];
}

// Sentinel that survives the single-`*` pass so we can translate `**` first
// without it being re-touched. Chosen to never collide with a real path.
const DOUBLE_STAR = "\0\0";

/**
 * Translate a path glob into an anchored RegExp.
 *
 * - `**` matches across segments (including `/`).
 * - `*` matches within a single segment (no `/`).
 * - Everything else is matched literally (regex metacharacters escaped).
 */
export function globToRegExp(glob: string): RegExp {
	// Escape regex metachars first (this also escapes `*`, which we undo next).
	const escaped = glob.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const translated = escaped
		// `\*\*` (escaped `**`) → cross-segment wildcard, via a placeholder.
		.replace(/\\\*\\\*/g, DOUBLE_STAR)
		// remaining `\*` (escaped single `*`) → within-segment wildcard.
		.replace(/\\\*/g, "[^/]*")
		.split(DOUBLE_STAR)
		.join(".*");
	return new RegExp(`^${translated}$`);
}

/** Whether `glob` matches `pathname`. A malformed glob never matches. */
export function matchGlob(glob: string, pathname: string): boolean {
	try {
		return globToRegExp(glob).test(pathname);
	} catch {
		return false;
	}
}

/**
 * Resolve whether the floating bar should be visible on `pathname`.
 *
 * - `null`/`undefined` rules → `true` (show everywhere). Keeps a new embed
 *   safe against servers that don't send the field yet, and an old embed safe
 *   against a server that does.
 * - Otherwise the **last** matching pattern (in list order) wins; if none
 *   match, `rules.default` decides.
 */
export function isVisibleForPath(
	rules: VisibilityRules | null | undefined,
	pathname: string,
): boolean {
	if (!rules) {
		return true;
	}
	let action: "show" | "hide" = rules.default ?? "show";
	for (const pattern of rules.patterns ?? []) {
		if (matchGlob(pattern.glob, pathname)) {
			action = pattern.action;
		}
	}
	return action !== "hide";
}
