/**
 * The chat's IndexedDB database, `waniwani-threads`. It holds the saved
 * conversations, keyed by the visitor id. Only the thread store opens it, and
 * only for a channel with thread history, because `indexedDB.open` creates the
 * database when it does not exist.
 */

export const DB_NAME = "waniwani-threads";
export const DB_VERSION = 1;
export const THREADS_STORE = "threads";
export const THREADS_BY_USER_INDEX = "by_memoryUserId";
export const THREADS_BY_UPDATED_INDEX = "by_updatedAt";

export function applyThreadDbUpgrade(db: IDBDatabase): void {
	if (!db.objectStoreNames.contains(THREADS_STORE)) {
		const threads = db.createObjectStore(THREADS_STORE, {
			keyPath: "threadId",
		});
		threads.createIndex(THREADS_BY_USER_INDEX, "memoryUserId", {
			unique: false,
		});
		threads.createIndex(THREADS_BY_UPDATED_INDEX, "updatedAt", {
			unique: false,
		});
	}
}

export async function openThreadDb(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, DB_VERSION);
		req.onupgradeneeded = () => {
			applyThreadDbUpgrade(req.result);
		};
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}
