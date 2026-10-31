import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { UIMessage } from "ai";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { Window } from "happy-dom";
import type { StoredThread } from "../thread-store";

const win = new Window({ url: "https://localhost" });
for (const key of ["document", "navigator", "localStorage"] as const) {
	// biome-ignore lint/suspicious/noExplicitAny: test setup
	(globalThis as any)[key] = (win as any)[key];
}
// biome-ignore lint/suspicious/noExplicitAny: test setup
(globalThis as any).window = win;
// biome-ignore lint/suspicious/noExplicitAny: test setup — install fake IDB regardless of suite ordering
(globalThis as any).indexedDB = new IDBFactory();
// biome-ignore lint/suspicious/noExplicitAny: test setup
(globalThis as any).IDBKeyRange = IDBKeyRange;

beforeEach(() => {
	// biome-ignore lint/suspicious/noExplicitAny: test setup — full reset between cases
	(globalThis as any).indexedDB = new IDBFactory();
});

afterEach(() => {
	// biome-ignore lint/suspicious/noExplicitAny: test teardown
	(globalThis as any).indexedDB = new IDBFactory();
	win.localStorage.clear();
});

async function importThreadStore() {
	return (await import(
		`../thread-store?t=${Date.now()}-${Math.random()}`
	)) as typeof import("../thread-store");
}

async function importMemoryDb() {
	return (await import(
		`../memory-db?t=${Date.now()}-${Math.random()}`
	)) as typeof import("../memory-db");
}

function makeMessage(id: string, text: string): UIMessage {
	return {
		id,
		role: "user",
		parts: [{ type: "text", text }],
	};
}

function makeThread(overrides: Partial<StoredThread> = {}): StoredThread {
	const now = new Date().toISOString();
	return {
		threadId: overrides.threadId ?? "thread-1",
		memoryUserId: overrides.memoryUserId ?? "user-1",
		title: overrides.title ?? "Test thread",
		messages: overrides.messages ?? [makeMessage("m1", "hello")],
		sessionId: overrides.sessionId,
		createdAt: overrides.createdAt ?? now,
		updatedAt: overrides.updatedAt ?? now,
	};
}

describe("thread-store", () => {
	test("upsert + load round-trips a thread", async () => {
		const store = await importThreadStore();
		const t = makeThread();
		await store.upsertThread(t);
		const loaded = await store.loadThread(t.threadId);
		expect(loaded).not.toBeNull();
		expect(loaded?.title).toBe("Test thread");
		expect(loaded?.messages.length).toBe(1);
	});

	test("listThreads filters by memoryUserId, newest first", async () => {
		const store = await importThreadStore();
		const t1 = makeThread({
			threadId: "a",
			memoryUserId: "u1",
			updatedAt: "2026-04-01T00:00:00.000Z",
		});
		const t2 = makeThread({
			threadId: "b",
			memoryUserId: "u1",
			updatedAt: "2026-04-02T00:00:00.000Z",
		});
		const tOther = makeThread({ threadId: "c", memoryUserId: "u2" });
		await store.upsertThread(t1);
		await store.upsertThread(t2);
		await store.upsertThread(tOther);

		const list = await store.listThreads("u1");
		expect(list.map((t) => t.threadId)).toEqual(["b", "a"]);
	});

	test("upsert overwrites and bumps updatedAt", async () => {
		const store = await importThreadStore();
		const t = makeThread({
			updatedAt: "2026-04-01T00:00:00.000Z",
		});
		await store.upsertThread(t);
		const updated = {
			...t,
			messages: [makeMessage("m1", "hello"), makeMessage("m2", "again")],
			updatedAt: "2026-04-05T00:00:00.000Z",
		};
		await store.upsertThread(updated);
		const loaded = await store.loadThread(t.threadId);
		expect(loaded?.messages.length).toBe(2);
		expect(loaded?.updatedAt).toBe("2026-04-05T00:00:00.000Z");
	});

	test("deleteThread removes the row", async () => {
		const store = await importThreadStore();
		const t = makeThread();
		await store.upsertThread(t);
		await store.deleteThread(t.threadId);
		const loaded = await store.loadThread(t.threadId);
		expect(loaded).toBeNull();
	});

	test("getActiveThreadId returns most-recently-updated thread", async () => {
		const store = await importThreadStore();
		await store.upsertThread(
			makeThread({
				threadId: "old",
				memoryUserId: "u1",
				updatedAt: "2026-04-01T00:00:00.000Z",
			}),
		);
		await store.upsertThread(
			makeThread({
				threadId: "new",
				memoryUserId: "u1",
				updatedAt: "2026-04-10T00:00:00.000Z",
			}),
		);

		const active = await store.getActiveThreadId("u1");
		expect(active).toBe("new");
	});

	test("two memoryUserIds see independent thread sets", async () => {
		const store = await importThreadStore();
		await store.upsertThread(makeThread({ threadId: "a", memoryUserId: "u1" }));
		await store.upsertThread(makeThread({ threadId: "b", memoryUserId: "u2" }));

		const u1 = await store.listThreads("u1");
		const u2 = await store.listThreads("u2");
		expect(u1.map((t) => t.threadId)).toEqual(["a"]);
		expect(u2.map((t) => t.threadId)).toEqual(["b"]);
	});

	test("upgrade path v1 → v2 adds the threads store and keeps the ids store", async () => {
		await new Promise<void>((resolve, reject) => {
			const req = indexedDB.open("waniwani-memory", 1);
			req.onupgradeneeded = () => {
				req.result.createObjectStore("ids");
			};
			req.onsuccess = () => {
				const db = req.result;
				const tx = db.transaction("ids", "readwrite");
				tx.objectStore("ids").put("kept", "other-key");
				tx.oncomplete = () => {
					db.close();
					resolve();
				};
				tx.onerror = () => reject(tx.error);
			};
			req.onerror = () => reject(req.error);
		});

		const memDb = await importMemoryDb();
		const db = await memDb.openMemoryDb();
		const stores = Array.from(db.objectStoreNames).sort();
		const kept = await new Promise((resolve, reject) => {
			const r = db
				.transaction("ids", "readonly")
				.objectStore("ids")
				.get("other-key");
			r.onsuccess = () => resolve(r.result);
			r.onerror = () => reject(r.error);
		});
		expect(db.version).toBe(2);
		db.close();
		expect(stores).toEqual(["ids", "threads"]);
		expect(kept).toBe("kept");

		const store = await importThreadStore();
		await store.upsertThread(makeThread({ memoryUserId: "visitor-1" }));
		const list = await store.listThreads("visitor-1");
		expect(list.length).toBe(1);
	});

	test("a v1 database with a legacy id: after migration the visitor's new threads list and the legacy id is gone", async () => {
		await new Promise<void>((resolve, reject) => {
			const req = indexedDB.open("waniwani-memory", 1);
			req.onupgradeneeded = () => {
				req.result.createObjectStore("ids");
			};
			req.onsuccess = () => {
				const db = req.result;
				const tx = db.transaction("ids", "readwrite");
				tx.objectStore("ids").put("legacy-user", "memoryUserId");
				tx.oncomplete = () => {
					db.close();
					resolve();
				};
				tx.onerror = () => reject(tx.error);
			};
			req.onerror = () => reject(req.error);
		});

		const memDb = await importMemoryDb();
		await memDb.migrateLegacyMemoryUserId("visitor-1");

		const store = await importThreadStore();
		await store.upsertThread(makeThread({ memoryUserId: "visitor-1" }));
		expect((await store.listThreads("visitor-1")).length).toBe(1);
		expect(await store.listThreads("legacy-user")).toEqual([]);

		const db = await memDb.openMemoryDb();
		const legacy = await new Promise((resolve, reject) => {
			const r = db
				.transaction("ids", "readonly")
				.objectStore("ids")
				.get("memoryUserId");
			r.onsuccess = () => resolve(r.result);
			r.onerror = () => reject(r.error);
		});
		db.close();
		expect(legacy).toBeUndefined();
	});
});

describe("thread-store — a reloaded turn still shows what was attached", () => {
	const DOCUMENTS = [
		{
			documentId: "doc_pdf",
			filename: "policy.pdf",
			mediaType: "application/pdf",
		},
	];

	test("a message's documents metadata survives the round-trip to IndexedDB", async () => {
		const store = await importThreadStore();
		const turn: UIMessage = {
			...makeMessage("m1", "read this"),
			metadata: { documents: DOCUMENTS },
		};

		await store.upsertThread(makeThread({ messages: [turn] }));
		const loaded = await store.loadThread("thread-1");

		expect(loaded?.messages[0]?.metadata).toEqual({ documents: DOCUMENTS });
	});

	test("the reloaded turn still carries no bytes, only the ids", async () => {
		const store = await importThreadStore();
		const turn: UIMessage = {
			...makeMessage("m1", "read this"),
			metadata: { documents: DOCUMENTS },
		};

		await store.upsertThread(makeThread({ messages: [turn] }));
		const loaded = await store.loadThread("thread-1");

		expect(JSON.stringify(loaded)).not.toContain("base64");
		expect(loaded?.messages[0]?.parts).toEqual([
			{ type: "text", text: "read this" },
		]);
	});
});
