export const DB_NAME = "waniwani-memory";
export const DB_VERSION = 2;
export const IDS_STORE = "ids";
export const THREADS_STORE = "threads";
export const THREADS_BY_USER_INDEX = "by_memoryUserId";
export const THREADS_BY_UPDATED_INDEX = "by_updatedAt";

// A second random device id the widget once kept beside the visitor id, used
// only to key thread history. Read here solely to move its threads to the
// visitor id and delete it.
const LEGACY_ID_KEY = "memoryUserId";
const LEGACY_LOCAL_STORAGE_KEY = "waniwani-memory-user-id";

export function applyMemoryDbUpgrade(
	db: IDBDatabase,
	oldVersion: number,
): void {
	if (oldVersion < 1) {
		if (!db.objectStoreNames.contains(IDS_STORE)) {
			db.createObjectStore(IDS_STORE);
		}
	}
	if (oldVersion < 2) {
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
}

export async function openMemoryDb(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, DB_VERSION);
		req.onupgradeneeded = (event) => {
			applyMemoryDbUpgrade(req.result, event.oldVersion);
		};
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

/** Opens the database only if it exists, so a visitor who never had one does not get one. */
function openExistingMemoryDb(): Promise<IDBDatabase | null> {
	return new Promise((resolve) => {
		const req = indexedDB.open(DB_NAME);
		req.onupgradeneeded = () => req.transaction?.abort();
		req.onerror = () => resolve(null);
		req.onsuccess = () => resolve(req.result);
	});
}

function readLegacyLocalStorage(): string | null {
	try {
		return localStorage.getItem(LEGACY_LOCAL_STORAGE_KEY);
	} catch {
		return null;
	}
}

function removeLegacyLocalStorage(): void {
	try {
		localStorage.removeItem(LEGACY_LOCAL_STORAGE_KEY);
	} catch {
		// Storage unavailable: nothing to remove.
	}
}

/**
 * Moves the threads saved under the legacy id to `visitorId`, then deletes the
 * legacy id from IndexedDB and `localStorage`. A no-op once done. Never throws
 * and never creates the database.
 */
export async function migrateLegacyMemoryUserId(
	visitorId: string,
): Promise<void> {
	const fromLocalStorage = readLegacyLocalStorage();
	if (typeof indexedDB === "undefined") {
		removeLegacyLocalStorage();
		return;
	}
	let db: IDBDatabase | null = null;
	try {
		db = await openExistingMemoryDb();
		if (!db?.objectStoreNames.contains(IDS_STORE)) {
			removeLegacyLocalStorage();
			return;
		}
		const hasThreads = db.objectStoreNames.contains(THREADS_STORE);
		const stores = hasThreads ? [IDS_STORE, THREADS_STORE] : [IDS_STORE];
		const tx = db.transaction(stores, "readwrite");
		const done = new Promise<void>((resolve, reject) => {
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
			tx.onabort = () => reject(tx.error);
		});
		const ids = tx.objectStore(IDS_STORE);
		const idReq = ids.get(LEGACY_ID_KEY);
		idReq.onsuccess = () => {
			const legacy =
				typeof idReq.result === "string" ? idReq.result : fromLocalStorage;
			ids.delete(LEGACY_ID_KEY);
			if (!hasThreads || !legacy || legacy === visitorId) {
				return;
			}
			const cursorReq = tx
				.objectStore(THREADS_STORE)
				.index(THREADS_BY_USER_INDEX)
				.openCursor(IDBKeyRange.only(legacy));
			cursorReq.onsuccess = () => {
				const cursor = cursorReq.result;
				if (!cursor) {
					return;
				}
				cursor.update({ ...cursor.value, memoryUserId: visitorId });
				cursor.continue();
			};
		};
		await done;
		removeLegacyLocalStorage();
	} catch {
		// Best effort: the next mount retries.
	} finally {
		db?.close();
	}
}
