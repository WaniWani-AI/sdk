import { beforeEach, describe, expect, test } from "bun:test";
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

async function importThreadStore() {
	return (await import(
		`../thread-store?t=${Date.now()}-${Math.random()}`
	)) as typeof import("../thread-store");
}

async function importMemoryUserId() {
	return (await import(
		`../memory-user-id?t=${Date.now()}-${Math.random()}`
	)) as typeof import("../memory-user-id");
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

	test("upgrade path v1 → v2 preserves the ids store", async () => {
		// Open as v1 with only the legacy `ids` store, write a memoryUserId.
		await new Promise<void>((resolve, reject) => {
			const req = indexedDB.open("waniwani-memory", 1);
			req.onupgradeneeded = () => {
				const db = req.result;
				if (!db.objectStoreNames.contains("ids")) {
					db.createObjectStore("ids");
				}
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

		// Re-open via the SDK helper which now requests v2; threads store must exist
		// AND the legacy id must still be readable.
		const memMod = await importMemoryUserId();
		const id = await memMod.getOrCreateMemoryUserId();
		expect(id).toBe("legacy-user");

		const store = await importThreadStore();
		await store.upsertThread(makeThread({ memoryUserId: "legacy-user" }));
		const list = await store.listThreads("legacy-user");
		expect(list.length).toBe(1);
	});
});
