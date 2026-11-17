/**
 * Deletes browser keys that the chat does not read, left by older releases.
 * Each one has a replacement the chat reads instead:
 *
 * - localStorage `waniwani-memory-user-id`: replaced by `waniwani-visitor-id`
 * - localStorage `waniwani:eve-conversation:*`: replaced by sessionStorage
 *   `waniwani-chat-session`
 * - sessionStorage `waniwani:config:*`: replaced by `waniwani-config`
 * - sessionStorage `waniwani:webmcp:session`: replaced by
 *   `waniwani-agent-session`
 * - IndexedDB database `waniwani-memory`: replaced by `waniwani-threads`. Its
 *   conversations are not moved. `deleteDatabase` never creates a database.
 */

const LEGACY_LOCAL_KEYS = ["waniwani-memory-user-id"];
const LEGACY_LOCAL_PREFIXES = ["waniwani:eve-conversation:"];
const LEGACY_SESSION_KEYS = ["waniwani:webmcp:session"];
const LEGACY_SESSION_PREFIXES = ["waniwani:config:"];
const LEGACY_DATABASE = "waniwani-memory";

function clean(
	storage: Storage | undefined,
	keys: readonly string[],
	prefixes: readonly string[],
): void {
	if (!storage) {
		return;
	}
	const found: string[] = [];
	for (let index = 0; index < storage.length; index += 1) {
		const key = storage.key(index);
		if (
			key !== null &&
			(keys.includes(key) || prefixes.some((p) => key.startsWith(p)))
		) {
			found.push(key);
		}
	}
	for (const key of found) {
		storage.removeItem(key);
	}
}

function storageOf(
	name: "localStorage" | "sessionStorage",
): Storage | undefined {
	try {
		return typeof globalThis[name] === "undefined"
			? undefined
			: globalThis[name];
	} catch {
		return undefined;
	}
}

let done = false;

/** Run the cleanup once per page load. Never throws. */
export function removeLegacyStorage(): void {
	if (done) {
		return;
	}
	done = true;
	try {
		clean(storageOf("localStorage"), LEGACY_LOCAL_KEYS, LEGACY_LOCAL_PREFIXES);
	} catch {
		// Storage blocked: nothing to delete.
	}
	try {
		clean(
			storageOf("sessionStorage"),
			LEGACY_SESSION_KEYS,
			LEGACY_SESSION_PREFIXES,
		);
	} catch {
		// Storage blocked: nothing to delete.
	}
	try {
		if (typeof indexedDB !== "undefined") {
			indexedDB.deleteDatabase(LEGACY_DATABASE);
		}
	} catch {
		// IndexedDB blocked: nothing to delete.
	}
}
