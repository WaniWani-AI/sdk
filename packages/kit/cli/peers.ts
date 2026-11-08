/**
 * The peer ranges this package declares, and what to do with them.
 *
 * `@waniwani/sdk`, react, react-dom and zod reach an app as peers rather than
 * as this package's own dependencies, so the app holds one copy and this
 * package states only the floor underneath it. Three callers need that floor
 * and each needs it differently: `init.ts` writes an installable range into a
 * new app, `validate.ts` checks the range an existing app already wrote, and
 * `codegen.ts` fills one in when neither the app nor the template declared
 * one. One module so the parsing exists once.
 *
 * Deliberately not a semver dependency. What appears in a real app's manifest
 * is an exact version, a caret, a tilde or a `>=` floor, and comparing those
 * against a floor is the whole job. Anything this cannot parse is reported as
 * unknown rather than guessed at — see `compare`.
 */

import { MANIFEST } from "./manifest.js";

/** A parsed version, with a prerelease tail that sorts below its release. */
interface Version {
	parts: [number, number, number];
	prerelease?: string;
}

/** The versions a dependency spec allows: `high` is exclusive, null unbounded. */
interface Window {
	low: Version;
	high: Version | null;
	exact?: boolean;
}

/** How a dependency spec sits against this package's floor. See `compare`. */
export type Verdict = "ok" | "reachable" | "below" | "prerelease" | "unknown";

/**
 * A peer range this package declares, read back out so it is stated once.
 *
 * Missing throws. A floor that silently defaulted would let every check below
 * pass vacuously, which is worse than the rename that removed it.
 */
export function peerRange(name: string): string {
	const range = MANIFEST.peerDependencies?.[name];
	if (!range) {
		throw new Error(
			`@waniwani/kit declares no peerDependencies.${name}, and its own tooling reads that floor — ` +
				"add it back to packages/kit/package.json, or drop the entry that reads it",
		);
	}
	return range;
}

/**
 * A peer range turned into something an app can depend on.
 *
 * A peer range is a floor, and a floor in an app's dependencies installs the
 * next major on the day it lands. Cap it. A range that already carries an upper
 * bound passes through as it is.
 *
 * The prerelease tail is part of the pattern because a floor can carry one,
 * which is what waiting on somebody else's release looks like here. Falling
 * through uncapped, that floor reaches a new app's manifest as the very thing
 * this exists to cap. Capping keeps the prerelease reachable and still stops at
 * the next boundary.
 */
export function installable(name: string): string {
	const range = peerRange(name);
	const floor = /^>=\s*(\d+)(?:\.(\d+))?(?:\.(\d+))?(-[0-9A-Za-z.-]+)?$/.exec(range.trim());
	return floor ? `^${floor[1]}.${floor[2] ?? 0}.${floor[3] ?? 0}${floor[4] ?? ""}` : range;
}

/** `1.2.3-beta.0` → `{ parts: [1,2,3], prerelease: "beta.0" }` */
function parseVersion(input: string): Version | null {
	const match = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?$/.exec(input.trim());
	if (!match) return null;
	return {
		parts: [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)],
		prerelease: match[4],
	};
}

/** Ordering on major.minor.patch, with a prerelease sorting below its release. */
function order(a: Version, b: Version): -1 | 0 | 1 {
	for (let i = 0; i < 3; i++) {
		if (a.parts[i] !== b.parts[i]) return (a.parts[i] as number) < (b.parts[i] as number) ? -1 : 1;
	}
	if (a.prerelease && !b.prerelease) return -1;
	if (!a.prerelease && b.prerelease) return 1;
	return 0;
}

/**
 * The window a dependency spec opens, as `{ low, high }`, where `high` is
 * exclusive and `null` means unbounded.
 *
 * Caret follows semver's 0.x rule, which is the one that matters for the SDK:
 * under a zero major the minor is the compatibility boundary, so a caret never
 * crosses one and an SDK minor is a breaking change.
 */
function window(spec: string): Window | null {
	const trimmed = spec.trim();
	if (trimmed === "*" || trimmed === "" || trimmed === "latest") {
		return { low: { parts: [0, 0, 0] }, high: null };
	}

	const ranged = /^(\^|~|>=)\s*(.+)$/.exec(trimmed);
	if (!ranged) {
		const exact = parseVersion(trimmed.replace(/^=\s*/, ""));
		return exact ? { low: exact, high: exact, exact: true } : null;
	}

	const low = parseVersion(ranged[2] as string);
	if (!low) return null;
	if (ranged[1] === ">=") return { low, high: null };

	const [major, minor] = low.parts;
	// `~1.2.3` caps at the next minor. `^1.2.3` caps at the next major, except
	// under 0.x where the minor is the compatibility boundary.
	const high: Version =
		ranged[1] === "~" || major === 0
			? { parts: [major, minor + 1, 0] }
			: { parts: [major + 1, 0, 0] };
	return { low, high };
}

/**
 * How a dependency spec sits against a peer floor.
 *
 * - `"ok"` — every version the spec allows is at or above the floor.
 * - `"reachable"` — the spec allows the floor, and also allows something below
 *   it. A fresh install lands above the floor and a lockfile written earlier
 *   can hold the tree below it, so this is a warning rather than an error.
 * - `"below"` — no version the spec allows reaches the floor. This one cannot
 *   resolve to a working tree.
 * - `"prerelease"` — a prerelease, at or above the floor by number, which npm's
 *   semver rules still exclude from a range carrying no prerelease of its own.
 *   Both npm and bun warn on it, so reporting it as `ok` would have this check
 *   disagreeing with the tool that actually resolves the tree.
 * - `"unknown"` — an expression this module does not parse (a union, a git
 *   URL, `workspace:*`). Reported as-is rather than assumed to be either.
 */
export function compare(spec: string | null | undefined, name: string): Verdict {
	const range = peerRange(name);
	const floorMatch = /^>=\s*(.+)$/.exec(range.trim());
	const floor = parseVersion(
		floorMatch ? (floorMatch[1] as string) : range.replace(/^[\^~=]\s*/, ""),
	);
	const allowed = spec == null ? null : window(spec);
	if (!floor || !allowed) return "unknown";

	// A prerelease is opt-in under semver: it does not satisfy a range that names
	// no prerelease at that version, however high the numbers read. The floor
	// carrying one of its own is someone pinning a prerelease on purpose, and
	// then the plain comparison is what they asked for.
	if (allowed.low.prerelease && !floor.prerelease) return "prerelease";
	if (order(allowed.low, floor) >= 0) return "ok";
	if (allowed.high === null || order(allowed.high, floor) > 0) return "reachable";
	return "below";
}

/** The floor itself, for a message that has to name it. */
export function floorOf(name: string): string {
	return peerRange(name);
}

/**
 * The lowest version a spec allows, normalised, or null if unparseable.
 *
 * `scripts/bump-deps.ts` asks the question this answers, and it is the mirror
 * of `compare`: that one checks a spec against this package's floor, while a
 * floor bump needs to know whether the *template's* floor has risen above it.
 */
export function floorVersion(spec: string | null | undefined): string | null {
	const allowed = spec == null ? null : window(spec);
	return allowed?.low ? allowed.low.parts.join(".") : null;
}

/** Ordering on two version strings, for a caller with no window to compare. */
export function compareVersions(a: string, b: string): -1 | 0 | 1 | null {
	const left = parseVersion(a);
	const right = parseVersion(b);
	if (!left || !right) return null;
	return order(left, right);
}

/**
 * Whether a dependency spec allows a given version.
 *
 * The mirror of `compare`, asked the other way round: that one measures a spec
 * against this package's floor, this one measures a published version against
 * a spec an app already wrote. An expression this module cannot parse answers
 * `true`, because the caller is deciding whether to nag someone and a range it
 * cannot read is not grounds for it.
 *
 * The prerelease rule is npm's: a range naming no prerelease of its own
 * excludes every prerelease, even one numerically inside it.
 */
export function allows(spec: string | null | undefined, version: string): boolean {
	const allowed = spec == null ? null : window(spec);
	const wanted = parseVersion(version);
	if (!allowed || !wanted) return true;
	if (wanted.prerelease && !allowed.low.prerelease) return false;
	if (order(wanted, allowed.low) < 0) return false;
	if (allowed.exact) return order(wanted, allowed.low) === 0;
	return allowed.high === null || order(wanted, allowed.high) < 0;
}

/**
 * The range a freshly scaffolded app should carry for a peer.
 *
 * `installable` alone answers this from the floor, and a floor is frozen at
 * release: a published kit keeps scaffolding whatever the SDK was on the day it
 * shipped, for as long as that kit is on npm, however many minors have landed
 * since. Passing what the registry says `latest` is (see `./registry.ts`) lets a
 * new app start on the newest SDK without this package cutting a release for
 * every SDK bump, which is the whole point of the dependency being a floor
 * rather than a pin.
 *
 * Two things it refuses to follow:
 *
 * A different major. Crossing one is a migration, and a scaffold picking that
 * up on the day it publishes would hand someone a template that no longer
 * compiles against the SDK it imports. Raising the floor is how a major
 * arrives, deliberately and with a template bump next to it.
 *
 * Anything the floor does not already accept — a `latest` that sits below it,
 * which is what a floor pinned to an unreleased prerelease looks like from
 * here. Writing that range would produce an app failing the kit's own check on
 * the first `waniwani check`.
 *
 * Inside a major it does follow the minor, and under semver's 0.x rule that is
 * a breaking boundary: an SDK minor that changes what the distribution template
 * imports reaches a newly scaffolded app immediately. That is the trade for not
 * shipping a kit release per SDK bump, and `scripts/bump-deps.ts` plus the
 * template contract are what catch the template half of it.
 */
export function preferred(name: string, latest: string | null): string {
	const base = installable(name);
	if (!latest) return base;

	const floor = parseVersion(peerRange(name).replace(/^>=\s*/, ""));
	const published = parseVersion(latest);
	if (!floor || !published || floor.parts[0] !== published.parts[0]) return base;

	const candidate = `^${latest}`;
	return compare(candidate, name) === "ok" ? candidate : base;
}
