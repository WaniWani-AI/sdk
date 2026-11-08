/**
 * What this machine knows about the Waniwani platform: the instance it talks to
 * and the OAuth session `waniwani login` opened against it.
 *
 * It lives in the user's config directory (`~/.config/waniwani/settings.json`,
 * or under `XDG_CONFIG_HOME`), never in an app repo. `.waniwani/` in an app is
 * build output that every command regenerates and `eject` says to delete, and a
 * refresh token does not belong in a directory that is safe to `rm -rf`. One
 * login also covers every repo on the machine, the way `gh` and `vercel` work.
 *
 * Per-app settings stay with the app: the org and agent an app is linked to are
 * in its `waniwani.json` (see ./project.ts).
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { dim } from "./ui.js";

/** The instances a developer can pick on first run. */
export type Region = "us" | "eu";

export const REGIONS: Record<Region, { label: string; apiUrl: string }> = {
	us: { label: "US", apiUrl: "https://app.waniwani.ai" },
	eu: { label: "EU", apiUrl: "https://eu.app.waniwani.ai" },
};

export const DEFAULT_API_URL = REGIONS.us.apiUrl;

export interface Settings {
	/** The instance the stored session was issued by. */
	apiUrl: string;
	/** The instance picked on first run, kept so `dev` does not ask again. */
	region: Region | null;
	accessToken: string | null;
	refreshToken: string | null;
	/** ISO 8601. */
	expiresAt: string | null;
	/** The OAuth client registered for this machine at login. */
	clientId: string | null;
}

const EMPTY: Settings = {
	apiUrl: DEFAULT_API_URL,
	region: null,
	accessToken: null,
	refreshToken: null,
	expiresAt: null,
	clientId: null,
};

const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

function settingsDir(): string {
	return join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "waniwani");
}

export function settingsFile(): string {
	return join(settingsDir(), "settings.json");
}

/**
 * Where older `@waniwani/cli` versions kept the same file: inside the repo they
 * ran from. Never read; see `noticeLegacy`.
 */
function legacyFile(root: string): string {
	return join(root, ".waniwani", "settings.json");
}

function stringOrNull(value: unknown): string | null {
	return typeof value === "string" && value.length > 0 ? value : null;
}

/** Field by field, so a hand-edited or truncated file degrades to "logged out". */
function parse(source: string): Settings {
	let raw: Record<string, unknown>;
	try {
		const parsed: unknown = JSON.parse(source);
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return EMPTY;
		raw = parsed as Record<string, unknown>;
	} catch {
		return EMPTY;
	}
	return {
		apiUrl: stringOrNull(raw.apiUrl) ?? DEFAULT_API_URL,
		region: raw.region === "us" || raw.region === "eu" ? raw.region : null,
		accessToken: stringOrNull(raw.accessToken),
		refreshToken: stringOrNull(raw.refreshToken),
		expiresAt: stringOrNull(raw.expiresAt),
		clientId: stringOrNull(raw.clientId),
	};
}

let legacyNoticed = false;

/**
 * Point at a repo-local settings file, once per run, without reading it.
 *
 * Its tokens are never taken. The file sits in a repo, and a cloned repo can
 * commit one holding a session of its author's choosing: taken, it would make
 * every later command act in that account, so `connect` would create agents in
 * someone else's org and `dev` would expose the local server through their
 * tunnel. Logging in again is the safe cost of an older `@waniwani/cli` setup.
 */
function noticeLegacy(root: string): void {
	if (legacyNoticed || !existsSync(legacyFile(root))) return;
	legacyNoticed = true;
	console.error(
		dim(
			`.waniwani/settings.json is ignored: logins live in ${settingsFile()}. Run \`waniwani login\`, then delete the old file.`,
		),
	);
}

export function readSettings(root: string): Settings {
	noticeLegacy(root);
	try {
		return parse(readFileSync(settingsFile(), "utf8"));
	} catch {
		return EMPTY;
	}
}

export function writeSettings(settings: Settings): void {
	const dir = settingsDir();
	mkdirSync(dir, { recursive: true, mode: DIR_MODE });
	chmodSync(dir, DIR_MODE);
	writeFileSync(settingsFile(), `${JSON.stringify(settings, null, "\t")}\n`, { mode: FILE_MODE });
	chmodSync(settingsFile(), FILE_MODE);
}

/** The session fields cleared, the instance kept. */
export function withoutSession(settings: Settings): Settings {
	return { ...settings, accessToken: null, refreshToken: null, expiresAt: null, clientId: null };
}
