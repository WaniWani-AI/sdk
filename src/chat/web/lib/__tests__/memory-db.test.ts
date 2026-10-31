import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { Window } from "happy-dom";

const win = new Window({ url: "https://localhost" });
// biome-ignore lint/suspicious/noExplicitAny: test setup
const g = globalThis as any;

const DB = "waniwani-memory";
const LEGACY_LS_KEY = "waniwani-memory-user-id";
const VISITOR = "visitor-abc";
const LEGACY = "legacy-xyz";

let savedGlobals: Record<string, unknown> = {};

beforeEach(() => {
	savedGlobals = {
		indexedDB: g.indexedDB,
		IDBKeyRange: g.IDBKeyRange,
		localStorage: g.localStorage,
	};
	g.indexedDB = new IDBFactory();
	g.IDBKeyRange = IDBKeyRange;
	g.localStorage = win.localStorage;
	win.localStorage.clear();
});

afterEach(() => {
	win.localStorage.clear();
	for (const [key, value] of Object.entries(savedGlobals)) {
		g[key] = value;
	}
});

async function importMemoryDb() {
	return (await import(
		`../memory-db?t=${Date.now()}-${Math.random()}`
	)) as typeof import("../memory-db");
}

interface RawThread {
	threadId: string;
	memoryUserId: string;
	title: string;
	messages: unknown[];
	createdAt: string;
	updatedAt: string;
}

function thread(
	threadId: string,
	owner: string,
	updatedAt?: string,
): RawThread {
	const at = updatedAt ?? "2026-04-01T00:00:00.000Z";
	return {
		threadId,
		memoryUserId: owner,
		title: threadId,
		messages: [
			{ id: "m1", role: "user", parts: [{ type: "text", text: "hi" }] },
		],
		createdAt: at,
		updatedAt: at,
	};
}

function openRaw(
	version: number,
	upgrade: (db: IDBDatabase) => void,
): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(DB, version);
		req.onupgradeneeded = () => upgrade(req.result);
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

function runTx(
	db: IDBDatabase,
	stores: string[],
	fn: (tx: IDBTransaction) => void,
): Promise<void> {
	return new Promise((resolve, reject) => {
		const tx = db.transaction(stores, "readwrite");
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
		tx.onabort = () => reject(tx.error);
		fn(tx);
	});
}

/** Seeds a v2 database the way the old widget left it. */
async function seedV2({
	legacyId,
	threads = [],
}: {
	legacyId?: unknown;
	threads?: RawThread[];
}): Promise<void> {
	const db = await openRaw(2, (d) => {
		d.createObjectStore("ids");
		const t = d.createObjectStore("threads", { keyPath: "threadId" });
		t.createIndex("by_memoryUserId", "memoryUserId", { unique: false });
		t.createIndex("by_updatedAt", "updatedAt", { unique: false });
	});
	await runTx(db, ["ids", "threads"], (tx) => {
		if (legacyId !== undefined) {
			tx.objectStore("ids").put(legacyId, "memoryUserId");
		}
		for (const t of threads) {
			tx.objectStore("threads").put(t);
		}
	});
	db.close();
}

/** Seeds a v1 database: the `ids` store only, before thread history existed. */
async function seedV1(legacyId: string): Promise<void> {
	const db = await openRaw(1, (d) => {
		d.createObjectStore("ids");
	});
	await runTx(db, ["ids"], (tx) => {
		tx.objectStore("ids").put(legacyId, "memoryUserId");
	});
	db.close();
}

async function readAll(): Promise<{
	version: number;
	stores: string[];
	legacyId: unknown;
	threads: RawThread[];
}> {
	const db = await new Promise<IDBDatabase>((resolve, reject) => {
		const req = indexedDB.open(DB);
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
	const stores = Array.from(db.objectStoreNames);
	let legacyId: unknown;
	let threads: RawThread[] = [];
	if (stores.includes("ids")) {
		legacyId = await new Promise((resolve, reject) => {
			const r = db
				.transaction("ids", "readonly")
				.objectStore("ids")
				.get("memoryUserId");
			r.onsuccess = () => resolve(r.result);
			r.onerror = () => reject(r.error);
		});
	}
	if (stores.includes("threads")) {
		threads = await new Promise((resolve, reject) => {
			const r = db
				.transaction("threads", "readonly")
				.objectStore("threads")
				.getAll();
			r.onsuccess = () => resolve(r.result);
			r.onerror = () => reject(r.error);
		});
	}
	const version = db.version;
	db.close();
	return { version, stores, legacyId, threads };
}

function ownersById(threads: RawThread[]): Record<string, string> {
	return Object.fromEntries(threads.map((t) => [t.threadId, t.memoryUserId]));
}

async function databaseNames(): Promise<string[]> {
	const list = await indexedDB.databases();
	return list.map((d) => d.name ?? "");
}

describe("migrateLegacyMemoryUserId: legacy id in IndexedDB", () => {
	test("re-keys every legacy thread to the visitor id and leaves other owners alone", async () => {
		await seedV2({
			legacyId: LEGACY,
			threads: [
				thread("a", LEGACY),
				thread("b", LEGACY),
				thread("mine", VISITOR),
				thread("theirs", "someone-else"),
			],
		});
		const { migrateLegacyMemoryUserId } = await importMemoryDb();

		await migrateLegacyMemoryUserId(VISITOR);

		const after = await readAll();
		expect(ownersById(after.threads)).toEqual({
			a: VISITOR,
			b: VISITOR,
			mine: VISITOR,
			theirs: "someone-else",
		});
	});

	test("keeps the thread contents intact while re-keying", async () => {
		const original = thread("a", LEGACY, "2026-03-03T00:00:00.000Z");
		await seedV2({ legacyId: LEGACY, threads: [original] });
		const { migrateLegacyMemoryUserId } = await importMemoryDb();

		await migrateLegacyMemoryUserId(VISITOR);

		const after = await readAll();
		expect(after.threads).toEqual([{ ...original, memoryUserId: VISITOR }]);
	});

	test("deletes the legacy key from IndexedDB and from localStorage", async () => {
		await seedV2({ legacyId: LEGACY, threads: [thread("a", LEGACY)] });
		localStorage.setItem(LEGACY_LS_KEY, LEGACY);
		const { migrateLegacyMemoryUserId } = await importMemoryDb();

		await migrateLegacyMemoryUserId(VISITOR);

		const after = await readAll();
		expect(after.legacyId).toBeUndefined();
		expect(localStorage.getItem(LEGACY_LS_KEY)).toBeNull();
	});

	test("moves more threads than the per-user cap without dropping any", async () => {
		const many = Array.from({ length: 75 }, (_, i) =>
			thread(
				`t${i}`,
				LEGACY,
				`2026-01-01T00:00:${String(i % 60).padStart(2, "0")}.000Z`,
			),
		);
		await seedV2({ legacyId: LEGACY, threads: many });
		const { migrateLegacyMemoryUserId } = await importMemoryDb();

		await migrateLegacyMemoryUserId(VISITOR);

		const after = await readAll();
		expect(after.threads).toHaveLength(75);
		expect(after.threads.every((t) => t.memoryUserId === VISITOR)).toBe(true);
	});

	test("the thread store lists the moved threads under the visitor id and none under the legacy id", async () => {
		await seedV2({
			legacyId: LEGACY,
			threads: [
				thread("old", LEGACY, "2026-01-01T00:00:00.000Z"),
				thread("new", VISITOR, "2026-02-01T00:00:00.000Z"),
			],
		});
		const { migrateLegacyMemoryUserId } = await importMemoryDb();
		await migrateLegacyMemoryUserId(VISITOR);

		const store = (await import(
			`../thread-store?t=${Date.now()}-${Math.random()}`
		)) as typeof import("../thread-store");
		const mine = await store.listThreads(VISITOR);
		const legacy = await store.listThreads(LEGACY);

		expect(mine.map((t) => t.threadId)).toEqual(["new", "old"]);
		expect(legacy).toEqual([]);
	});
});

describe("migrateLegacyMemoryUserId: legacy id only in localStorage", () => {
	test("re-keys the threads stored under the localStorage id and removes the key", async () => {
		await seedV2({
			threads: [thread("a", LEGACY), thread("theirs", "someone-else")],
		});
		localStorage.setItem(LEGACY_LS_KEY, LEGACY);
		const { migrateLegacyMemoryUserId } = await importMemoryDb();

		await migrateLegacyMemoryUserId(VISITOR);

		const after = await readAll();
		expect(ownersById(after.threads)).toEqual({
			a: VISITOR,
			theirs: "someone-else",
		});
		expect(localStorage.getItem(LEGACY_LS_KEY)).toBeNull();
	});

	test("a non-string value under the IndexedDB key falls back to the localStorage id", async () => {
		await seedV2({ legacyId: 42, threads: [thread("a", LEGACY)] });
		localStorage.setItem(LEGACY_LS_KEY, LEGACY);
		const { migrateLegacyMemoryUserId } = await importMemoryDb();

		await migrateLegacyMemoryUserId(VISITOR);

		const after = await readAll();
		expect(ownersById(after.threads)).toEqual({ a: VISITOR });
		expect(after.legacyId).toBeUndefined();
		expect(localStorage.getItem(LEGACY_LS_KEY)).toBeNull();
	});
});

describe("migrateLegacyMemoryUserId: idempotent", () => {
	test("a second run changes nothing, including threads saved under the visitor id in between", async () => {
		await seedV2({
			legacyId: LEGACY,
			threads: [thread("a", LEGACY), thread("theirs", "someone-else")],
		});
		const { migrateLegacyMemoryUserId } = await importMemoryDb();

		await migrateLegacyMemoryUserId(VISITOR);
		const once = await readAll();
		await migrateLegacyMemoryUserId(VISITOR);
		await migrateLegacyMemoryUserId(VISITOR);
		const thrice = await readAll();

		expect(thrice).toEqual(once);
		expect(ownersById(thrice.threads)).toEqual({
			a: VISITOR,
			theirs: "someone-else",
		});
	});

	test("after migrating to one visitor, a later run with a different visitor id moves nothing", async () => {
		await seedV2({ legacyId: LEGACY, threads: [thread("a", LEGACY)] });
		const { migrateLegacyMemoryUserId } = await importMemoryDb();

		await migrateLegacyMemoryUserId(VISITOR);
		await migrateLegacyMemoryUserId("another-visitor");

		const after = await readAll();
		expect(ownersById(after.threads)).toEqual({ a: VISITOR });
	});

	test("two runs started at once both resolve and leave every legacy thread under the visitor id", async () => {
		await seedV2({
			legacyId: LEGACY,
			threads: [thread("a", LEGACY), thread("b", LEGACY)],
		});
		const { migrateLegacyMemoryUserId } = await importMemoryDb();

		await Promise.all([
			migrateLegacyMemoryUserId(VISITOR),
			migrateLegacyMemoryUserId(VISITOR),
		]);

		const after = await readAll();
		expect(ownersById(after.threads)).toEqual({ a: VISITOR, b: VISITOR });
		expect(after.legacyId).toBeUndefined();
	});
});

describe("migrateLegacyMemoryUserId: legacy id equals the visitor id", () => {
	test("keeps every thread and still deletes the legacy key", async () => {
		await seedV2({
			legacyId: VISITOR,
			threads: [thread("a", VISITOR), thread("theirs", "someone-else")],
		});
		localStorage.setItem(LEGACY_LS_KEY, VISITOR);
		const { migrateLegacyMemoryUserId } = await importMemoryDb();

		await migrateLegacyMemoryUserId(VISITOR);

		const after = await readAll();
		expect(ownersById(after.threads)).toEqual({
			a: VISITOR,
			theirs: "someone-else",
		});
		expect(after.legacyId).toBeUndefined();
		expect(localStorage.getItem(LEGACY_LS_KEY)).toBeNull();
	});
});

describe("migrateLegacyMemoryUserId: no database yet", () => {
	test("does not create the database when none exists", async () => {
		expect(await databaseNames()).not.toContain(DB);
		const { migrateLegacyMemoryUserId } = await importMemoryDb();

		await migrateLegacyMemoryUserId(VISITOR);

		expect(await databaseNames()).not.toContain(DB);
	});

	test("does not create the database, and clears a localStorage-only legacy id", async () => {
		localStorage.setItem(LEGACY_LS_KEY, LEGACY);
		const { migrateLegacyMemoryUserId } = await importMemoryDb();

		await migrateLegacyMemoryUserId(VISITOR);

		expect(await databaseNames()).not.toContain(DB);
		expect(localStorage.getItem(LEGACY_LS_KEY)).toBeNull();
	});

	test("the thread store still creates the database at version 2 afterwards", async () => {
		const { migrateLegacyMemoryUserId } = await importMemoryDb();
		await migrateLegacyMemoryUserId(VISITOR);

		const store = (await import(
			`../thread-store?t=${Date.now()}-${Math.random()}`
		)) as typeof import("../thread-store");
		await store.upsertThread({
			...thread("a", VISITOR),
			messages: [],
		});

		const after = await readAll();
		expect(after.version).toBe(2);
		expect(ownersById(after.threads)).toEqual({ a: VISITOR });
	});
});

describe("migrateLegacyMemoryUserId: version 1 database", () => {
	test("resolves, deletes the legacy key and leaves the database usable by the thread store", async () => {
		await seedV1(LEGACY);
		localStorage.setItem(LEGACY_LS_KEY, LEGACY);
		const { migrateLegacyMemoryUserId } = await importMemoryDb();

		await migrateLegacyMemoryUserId(VISITOR);

		const mid = await readAll();
		expect(mid.legacyId).toBeUndefined();
		expect(localStorage.getItem(LEGACY_LS_KEY)).toBeNull();

		const store = (await import(
			`../thread-store?t=${Date.now()}-${Math.random()}`
		)) as typeof import("../thread-store");
		await store.upsertThread({ ...thread("a", VISITOR), messages: [] });
		const list = await store.listThreads(VISITOR);
		expect(list.map((t) => t.threadId)).toEqual(["a"]);
	});
});

describe("migrateLegacyMemoryUserId: never throws", () => {
	test("resolves with no indexedDB and still clears the localStorage key", async () => {
		g.indexedDB = undefined;
		localStorage.setItem(LEGACY_LS_KEY, LEGACY);
		const { migrateLegacyMemoryUserId } = await importMemoryDb();

		await expect(migrateLegacyMemoryUserId(VISITOR)).resolves.toBeUndefined();
		expect(localStorage.getItem(LEGACY_LS_KEY)).toBeNull();
	});

	test("resolves when indexedDB.open throws synchronously", async () => {
		g.indexedDB = {
			open: () => {
				throw new Error("SecurityError");
			},
		};
		const { migrateLegacyMemoryUserId } = await importMemoryDb();

		await expect(migrateLegacyMemoryUserId(VISITOR)).resolves.toBeUndefined();
	});

	test("resolves when the open request fails", async () => {
		g.indexedDB = {
			open: () => {
				const req: { onerror?: () => void; error: Error } = {
					error: new Error("blocked"),
				};
				setTimeout(() => req.onerror?.(), 0);
				return req;
			},
		};
		const { migrateLegacyMemoryUserId } = await importMemoryDb();

		await expect(migrateLegacyMemoryUserId(VISITOR)).resolves.toBeUndefined();
	});

	test("resolves when localStorage throws on every access", async () => {
		await seedV2({ legacyId: LEGACY, threads: [thread("a", LEGACY)] });
		g.localStorage = {
			getItem: () => {
				throw new Error("blocked");
			},
			setItem: () => {
				throw new Error("blocked");
			},
			removeItem: () => {
				throw new Error("blocked");
			},
			clear: () => {},
			key: () => null,
			length: 0,
		};
		const { migrateLegacyMemoryUserId } = await importMemoryDb();

		await expect(migrateLegacyMemoryUserId(VISITOR)).resolves.toBeUndefined();
		const after = await readAll();
		expect(ownersById(after.threads)).toEqual({ a: VISITOR });
	});

	test("resolves when localStorage is not defined at all", async () => {
		await seedV2({ legacyId: LEGACY, threads: [thread("a", LEGACY)] });
		g.localStorage = undefined;
		const { migrateLegacyMemoryUserId } = await importMemoryDb();

		await expect(migrateLegacyMemoryUserId(VISITOR)).resolves.toBeUndefined();
		const after = await readAll();
		expect(ownersById(after.threads)).toEqual({ a: VISITOR });
	});
});
