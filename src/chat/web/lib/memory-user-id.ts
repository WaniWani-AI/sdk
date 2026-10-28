import { hasStorageConsent, onConsentChange } from "../../../shared/consent";

export const DB_NAME = "waniwani-memory";
export const DB_VERSION = 2;
export const IDS_STORE = "ids";
export const THREADS_STORE = "threads";
export const THREADS_BY_USER_INDEX = "by_memoryUserId";
export const THREADS_BY_UPDATED_INDEX = "by_updatedAt";

const STORE_NAME = IDS_STORE;
const KEY = "memoryUserId";
const LOCAL_STORAGE_KEY = "waniwani-memory-user-id";

let inMemoryFallbackId: string | null = null;
// Used while consent is not granted, so nothing touches IndexedDB or
// localStorage for this id.
let pageMemoryUserId: string | null = null;

onConsentChange((consent) => {
	if (consent === "granted") {
		pageMemoryUserId = null;
		return;
	}
	pageMemoryUserId = null;
	if (consent === "denied") {
		void deleteStoredMemoryUserId();
	}
});

function generateUuid(): string {
	if (
		typeof crypto !== "undefined" &&
		typeof crypto.randomUUID === "function"
	) {
		return crypto.randomUUID();
	}
	// Fallback for environments without crypto.randomUUID
	return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
		const r = (Math.random() * 16) | 0;
		const v = c === "x" ? r : (r & 0x3) | 0x8;
		return v.toString(16);
	});
}

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

async function openDb(): Promise<IDBDatabase> {
	return openMemoryDb();
}

async function idbGet(db: IDBDatabase): Promise<string | null> {
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE_NAME, "readonly");
		const store = tx.objectStore(STORE_NAME);
		const req = store.get(KEY);
		req.onsuccess = () =>
			resolve(typeof req.result === "string" ? req.result : null);
		req.onerror = () => reject(req.error);
	});
}

async function idbPut(db: IDBDatabase, value: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE_NAME, "readwrite");
		const store = tx.objectStore(STORE_NAME);
		const req = store.put(value, KEY);
		req.onsuccess = () => resolve();
		req.onerror = () => reject(req.error);
	});
}

async function tryIndexedDb(): Promise<string | null> {
	if (typeof indexedDB === "undefined") {
		return null;
	}
	try {
		const db = await openDb();
		try {
			const existing = await idbGet(db);
			if (existing) {
				return existing;
			}
			const next = generateUuid();
			await idbPut(db, next);
			return next;
		} finally {
			db.close();
		}
	} catch {
		return null;
	}
}

function tryLocalStorage(): string | null {
	try {
		const existing = localStorage.getItem(LOCAL_STORAGE_KEY);
		if (existing) {
			return existing;
		}
		const next = generateUuid();
		localStorage.setItem(LOCAL_STORAGE_KEY, next);
		return next;
	} catch {
		return null;
	}
}

/** Remove the persisted id from both stores. Never throws. */
export async function deleteStoredMemoryUserId(): Promise<void> {
	inMemoryFallbackId = null;
	try {
		localStorage.removeItem(LOCAL_STORAGE_KEY);
	} catch {
		// Storage unavailable: nothing was persisted there.
	}
	if (typeof indexedDB === "undefined") {
		return;
	}
	await new Promise<void>((resolve) => {
		try {
			// No version: an existing database opens as it is, and a missing one
			// raises `upgradeneeded`, which is aborted so a denial never creates it.
			const req = indexedDB.open(DB_NAME);
			req.onupgradeneeded = () => req.transaction?.abort();
			req.onerror = () => resolve();
			req.onsuccess = () => {
				const db = req.result;
				try {
					const tx = db.transaction(STORE_NAME, "readwrite");
					tx.objectStore(STORE_NAME).delete(KEY);
					tx.oncomplete =
						tx.onerror =
						tx.onabort =
							() => {
								db.close();
								resolve();
							};
				} catch {
					db.close();
					resolve();
				}
			};
		} catch {
			resolve();
		}
	});
}

export async function getOrCreateMemoryUserId(): Promise<string> {
	if (!hasStorageConsent()) {
		pageMemoryUserId ??= generateUuid();
		return pageMemoryUserId;
	}

	const fromIdb = await tryIndexedDb();
	if (fromIdb) {
		return fromIdb;
	}

	const fromLs = tryLocalStorage();
	if (fromLs) {
		return fromLs;
	}

	if (!inMemoryFallbackId) {
		inMemoryFallbackId = generateUuid();
	}
	return inMemoryFallbackId;
}
