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
		visitorId: overrides.visitorId ?? "user-1",
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

	test("listThreads filters by visitorId, newest first", async () => {
		const store = await importThreadStore();
		const t1 = makeThread({
			threadId: "a",
			visitorId: "u1",
			updatedAt: "2026-04-01T00:00:00.000Z",
		});
		const t2 = makeThread({
			threadId: "b",
			visitorId: "u1",
			updatedAt: "2026-04-02T00:00:00.000Z",
		});
		const tOther = makeThread({ threadId: "c", visitorId: "u2" });
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
				visitorId: "u1",
				updatedAt: "2026-04-01T00:00:00.000Z",
			}),
		);
		await store.upsertThread(
			makeThread({
				threadId: "new",
				visitorId: "u1",
				updatedAt: "2026-04-10T00:00:00.000Z",
			}),
		);

		const active = await store.getActiveThreadId("u1");
		expect(active).toBe("new");
	});

	test("two visitorIds see independent thread sets", async () => {
		const store = await importThreadStore();
		await store.upsertThread(makeThread({ threadId: "a", visitorId: "u1" }));
		await store.upsertThread(makeThread({ threadId: "b", visitorId: "u2" }));

		const u1 = await store.listThreads("u1");
		const u2 = await store.listThreads("u2");
		expect(u1.map((t) => t.threadId)).toEqual(["a"]);
		expect(u2.map((t) => t.threadId)).toEqual(["b"]);
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

describe("thread-store: threads expire 13 months after creation", () => {
	const DAY = 24 * 60 * 60 * 1000;

	test("listThreads hides and deletes a thread 13 months old", async () => {
		const store = await importThreadStore();
		const old = new Date(Date.now() - 396 * DAY).toISOString();
		await store.upsertThread(
			makeThread({ threadId: "fresh", visitorId: "u1" }),
		);
		await store.upsertThread(
			makeThread({
				threadId: "old",
				visitorId: "u1",
				createdAt: old,
				updatedAt: new Date().toISOString(),
			}),
		);

		const list = await store.listThreads("u1");
		expect(list.map((t) => t.threadId)).toEqual(["fresh"]);
		expect(await store.loadThread("old")).toBeNull();
	});

	test("a thread updated recently still expires from its creation date", async () => {
		const store = await importThreadStore();
		expect(
			store.isExpiredThread({
				createdAt: new Date(Date.now() - 396 * DAY).toISOString(),
			}),
		).toBe(true);
		expect(
			store.isExpiredThread({
				createdAt: new Date(Date.now() - 300 * DAY).toISOString(),
			}),
		).toBe(false);
	});
});
