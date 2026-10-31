import type { UIMessage } from "ai";
import {
	openMemoryDb,
	THREADS_BY_USER_INDEX,
	THREADS_STORE,
} from "./memory-user-id";

export interface StoredThread {
	threadId: string;
	memoryUserId: string;
	title: string;
	messages: UIMessage[];
	sessionId?: string;
	createdAt: string;
	updatedAt: string;
}

export const MAX_THREADS_PER_USER = 50;
export const MAX_MESSAGES_PER_THREAD = 1000;

function isStoredThread(value: unknown): value is StoredThread {
	if (!value || typeof value !== "object") {
		return false;
	}
	const v = value as Record<string, unknown>;
	return (
		typeof v.threadId === "string" &&
		typeof v.memoryUserId === "string" &&
		typeof v.title === "string" &&
		Array.isArray(v.messages) &&
		typeof v.createdAt === "string" &&
		typeof v.updatedAt === "string"
	);
}

async function withDb<T>(
	fn: (db: IDBDatabase) => Promise<T>,
): Promise<T | null> {
	if (typeof indexedDB === "undefined") {
		return null;
	}
	let db: IDBDatabase | null = null;
	try {
		db = await openMemoryDb();
		return await fn(db);
	} catch {
		return null;
	} finally {
		try {
			db?.close();
		} catch {
			// ignore
		}
	}
}

function promisifyRequest<T>(req: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

export async function listThreads(
	memoryUserId: string,
): Promise<StoredThread[]> {
	const result = await withDb(async (db) => {
		const tx = db.transaction(THREADS_STORE, "readonly");
		const store = tx.objectStore(THREADS_STORE);
		const index = store.index(THREADS_BY_USER_INDEX);
		const all = await promisifyRequest(index.getAll(memoryUserId));
		const threads = (all ?? []).filter(isStoredThread);
		threads.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
		return threads;
	});
	return result ?? [];
}

export async function loadThread(
	threadId: string,
): Promise<StoredThread | null> {
	const result = await withDb(async (db) => {
		const tx = db.transaction(THREADS_STORE, "readonly");
		const store = tx.objectStore(THREADS_STORE);
		const value = await promisifyRequest(store.get(threadId));
		return isStoredThread(value) ? value : null;
	});
	return result ?? null;
}

export async function upsertThread(thread: StoredThread): Promise<void> {
	if (!isStoredThread(thread)) {
		return;
	}
	const trimmed: StoredThread =
		thread.messages.length > MAX_MESSAGES_PER_THREAD
			? {
					...thread,
					messages: thread.messages.slice(
						thread.messages.length - MAX_MESSAGES_PER_THREAD,
					),
				}
			: thread;

	await withDb(async (db) => {
		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction(THREADS_STORE, "readwrite");
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
			tx.onabort = () => reject(tx.error);
			const store = tx.objectStore(THREADS_STORE);
			store.put(trimmed);
		});

		// Evict oldest threads beyond the per-user cap.
		const tx2 = db.transaction(THREADS_STORE, "readwrite");
		const store2 = tx2.objectStore(THREADS_STORE);
		const index = store2.index(THREADS_BY_USER_INDEX);
		const all = await promisifyRequest(index.getAll(trimmed.memoryUserId));
		const userThreads = (all ?? []).filter(isStoredThread);
		if (userThreads.length > MAX_THREADS_PER_USER) {
			userThreads.sort((a, b) => (a.updatedAt < b.updatedAt ? -1 : 1));
			const toEvict = userThreads.slice(
				0,
				userThreads.length - MAX_THREADS_PER_USER,
			);
			for (const t of toEvict) {
				store2.delete(t.threadId);
			}
		}
		await new Promise<void>((resolve, reject) => {
			tx2.oncomplete = () => resolve();
			tx2.onerror = () => reject(tx2.error);
			tx2.onabort = () => reject(tx2.error);
		});
		return null;
	});
}

export async function deleteThread(threadId: string): Promise<void> {
	await withDb(async (db) => {
		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction(THREADS_STORE, "readwrite");
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
			tx.onabort = () => reject(tx.error);
			tx.objectStore(THREADS_STORE).delete(threadId);
		});
		return null;
	});
}

export async function getActiveThreadId(
	memoryUserId: string,
): Promise<string | null> {
	const threads = await listThreads(memoryUserId);
	return threads[0]?.threadId ?? null;
}

export function deriveThreadTitle(text: string): string {
	const trimmed = text.trim();
	if (!trimmed) {
		return `Conversation on ${new Date().toISOString().slice(0, 10)}`;
	}
	const firstLine = trimmed.split(/\r?\n/, 1)[0] ?? trimmed;
	if (firstLine.length <= 60) {
		return firstLine;
	}
	return `${firstLine.slice(0, 60).trimEnd()}…`;
}
