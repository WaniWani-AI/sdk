const DB_NAME = "waniwani-memory";
const STORE_NAME = "ids";
const KEY = "memoryUserId";
const LOCAL_STORAGE_KEY = "waniwani-memory-user-id";

let inMemoryFallbackId: string | null = null;

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

async function openDb(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, 1);
		req.onupgradeneeded = () => {
			const db = req.result;
			if (!db.objectStoreNames.contains(STORE_NAME)) {
				db.createObjectStore(STORE_NAME);
			}
		};
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
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

export async function getOrCreateMemoryUserId(): Promise<string> {
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
