/**
 * The published version of the one dependency this kit does not pin.
 *
 * `@waniwani/sdk` reaches an app as a peer floor rather than as a pin (see
 * `./peers.ts`), which keeps an app free to choose its own version and keeps
 * this package out of the way. The cost is staleness: the floor is written when
 * the kit is released and does not move afterwards, so a new app scaffolded
 * months later still starts on whatever was current the day the floor was set,
 * and an app that never touches its manifest never hears that a newer SDK
 * exists. Both are answered by asking the registry rather than by cutting a kit
 * release for every SDK bump.
 *
 * Everything here fails soft. A lookup that times out, a machine with no
 * network, a registry returning nonsense: all of them return the cached answer
 * if there is one and `null` otherwise, and every caller treats `null` as "say
 * nothing". No command in this CLI fails because npm was slow.
 *
 * Set `WANIWANI_OFFLINE=1` to skip the network entirely. The disk cache is
 * still read, so a machine that has looked once keeps the answer.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const CACHE_ROOT = join(homedir(), ".cache", "waniwani", "registry");

/**
 * How long an answer stands before it is looked up again.
 *
 * `validateApp` runs on `check`, `dev`, `build` and `start`, and the dev loop
 * re-runs it on every file change. Without a cache that is a registry round
 * trip per keystroke-ish, which is both rude and slow enough to notice. Six
 * hours means at most a handful of requests a day from a machine someone is
 * working on, and a released SDK that lands mid-afternoon is heard about the
 * same day.
 */
const TTL_MS = 6 * 60 * 60 * 1000;

/**
 * Short on purpose. This is a nicety on top of a check that already has its
 * answer, so waiting on a hanging socket costs more than the information is
 * worth.
 */
const TIMEOUT_MS = 2500;

interface CacheEntry {
	version: string;
	at: number;
}

/** `@waniwani/sdk` -> a filename with no directory separator left in it. */
function cacheFile(name: string): string {
	return join(CACHE_ROOT, `${name.replace(/[@/]/g, "_")}.json`);
}

function readCache(name: string): CacheEntry | null {
	const file = cacheFile(name);
	if (!existsSync(file)) return null;
	try {
		const parsed = JSON.parse(readFileSync(file, "utf-8")) as CacheEntry;
		return typeof parsed.version === "string" && typeof parsed.at === "number" ? parsed : null;
	} catch {
		// A truncated or hand-edited cache file is not worth an error message on
		// a command that was doing something else.
		return null;
	}
}

function writeCache(name: string, version: string): void {
	try {
		mkdirSync(CACHE_ROOT, { recursive: true });
		writeFileSync(cacheFile(name), JSON.stringify({ version, at: Date.now() }));
	} catch {
		// A read-only HOME, a full disk. The lookup still worked; only the next
		// one pays for it.
	}
}

/**
 * The version behind a package's `latest` dist-tag, or null.
 *
 * `latest` and not `beta`: a prerelease is something a maintainer opts into by
 * hand, and both npm and bun exclude one from a range that names none. A kit
 * floor carrying a prerelease is exactly that opt-in, and an answer read from
 * here must not quietly undo it.
 *
 * The scoped path is written unencoded because that is the form the registry's
 * `/<name>/latest` endpoint serves; `%40scope%2Fname` answers the packument
 * endpoint but not this one.
 */
export async function latestVersion(name: string): Promise<string | null> {
	const cached = readCache(name);
	if (cached && Date.now() - cached.at < TTL_MS) return cached.version;
	if (process.env.WANIWANI_OFFLINE) return cached?.version ?? null;

	try {
		const response = await fetch(`https://registry.npmjs.org/${name}/latest`, {
			headers: { Accept: "application/json" },
			signal: AbortSignal.timeout(TIMEOUT_MS),
		});
		if (!response.ok) return cached?.version ?? null;
		const { version } = (await response.json()) as { version?: unknown };
		if (typeof version !== "string" || !/^\d+\.\d+\.\d+/.test(version)) {
			return cached?.version ?? null;
		}
		writeCache(name, version);
		return version;
	} catch {
		// Offline, DNS, a proxy, the timeout above. A stale answer beats none.
		return cached?.version ?? null;
	}
}
