import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { Window } from "happy-dom";

const win = new Window({ url: "https://localhost" });
for (const key of ["document", "navigator", "localStorage"] as const) {
	// biome-ignore lint/suspicious/noExplicitAny: test setup
	(globalThis as any)[key] = (win as any)[key];
}
// biome-ignore lint/suspicious/noExplicitAny: test setup
(globalThis as any).window = win;
// biome-ignore lint/suspicious/noExplicitAny: test setup
(globalThis as any).IDBKeyRange = IDBKeyRange;

const { setConsent } = await import("../../../../shared/consent");
const { DB_NAME, deleteStoredMemoryUserId, getOrCreateMemoryUserId } =
	await import("../memory-user-id");

const LS_KEY = "waniwani-memory-user-id";

/** Counts every `indexedDB.open` against a real fake-indexeddb factory. */
function installIdb(): { factory: IDBFactory; opens: string[] } {
	const factory = new IDBFactory();
	const opens: string[] = [];
	const counting = {
		open(name: string, version?: number) {
			opens.push(name);
			return version === undefined
				? factory.open(name)
				: factory.open(name, version);
		},
		deleteDatabase(name: string) {
			return factory.deleteDatabase(name);
		},
		databases() {
			return factory.databases();
		},
		cmp(a: unknown, b: unknown) {
			return factory.cmp(a, b);
		},
	};
	// biome-ignore lint/suspicious/noExplicitAny: test setup
	(globalThis as any).indexedDB = counting;
	return { factory, opens };
}

/** Records localStorage writes to the memory key. */
function installSpyStorage(): string[] {
	const real = win.localStorage;
	const writes: string[] = [];
	const spy = {
		getItem: (key: string) => {
			if (key === LS_KEY) {
				writes.push(`get:${key}`);
			}
			return real.getItem(key);
		},
		setItem: (key: string, value: string) => {
			if (key === LS_KEY) {
				writes.push(`set:${key}`);
			}
			real.setItem(key, value);
		},
		removeItem: (key: string) => real.removeItem(key),
		clear: () => real.clear(),
		key: (i: number) => real.key(i),
		get length() {
			return real.length;
		},
	};
	// biome-ignore lint/suspicious/noExplicitAny: test setup
	(globalThis as any).localStorage = spy;
	return writes;
}

async function databaseNames(factory: IDBFactory): Promise<string[]> {
	const dbs = await factory.databases();
	return dbs.map((d) => d.name ?? "");
}

async function readIdbId(factory: IDBFactory): Promise<unknown> {
	return new Promise((resolve, reject) => {
		const req = factory.open(DB_NAME);
		req.onsuccess = () => {
			const db = req.result;
			const tx = db.transaction("ids", "readonly");
			const get = tx.objectStore("ids").get("memoryUserId");
			get.onsuccess = () => {
				db.close();
				resolve(get.result);
			};
			get.onerror = () => reject(get.error);
		};
		req.onerror = () => reject(req.error);
	});
}

/** The denial listener deletes asynchronously; wait until the condition holds or time out. */
async function waitFor(check: () => Promise<boolean> | boolean): Promise<void> {
	for (let i = 0; i < 100; i++) {
		if (await check()) {
			return;
		}
		await new Promise((r) => setTimeout(r, 5));
	}
	throw new Error("condition never held");
}

beforeEach(() => {
	// biome-ignore lint/suspicious/noExplicitAny: test setup
	(globalThis as any).localStorage = win.localStorage;
	win.localStorage.clear();
});

afterEach(async () => {
	setConsent("granted");
	// Let any denial cleanup settle before the next test swaps the factory.
	await new Promise((r) => setTimeout(r, 20));
	// biome-ignore lint/suspicious/noExplicitAny: test setup
	(globalThis as any).localStorage = win.localStorage;
	win.localStorage.clear();
});

describe("getOrCreateMemoryUserId without consent", () => {
	test("pending: no IndexedDB open, no localStorage access, stable id", async () => {
		const { factory, opens } = installIdb();
		setConsent("pending");
		const writes = installSpyStorage();
		const a = await getOrCreateMemoryUserId();
		const b = await getOrCreateMemoryUserId();
		expect(typeof a).toBe("string");
		expect(a.length).toBeGreaterThan(10);
		expect(b).toBe(a);
		expect(opens).toEqual([]);
		expect(writes).toEqual([]);
		expect(await databaseNames(factory)).not.toContain(DB_NAME);
		expect(win.localStorage.getItem(LS_KEY)).toBeNull();
	});

	test("denied: no IndexedDB open, no localStorage write, stable id", async () => {
		const { opens } = installIdb();
		setConsent("denied");
		await new Promise((r) => setTimeout(r, 20));
		opens.length = 0;
		const writes = installSpyStorage();
		const a = await getOrCreateMemoryUserId();
		const b = await getOrCreateMemoryUserId();
		expect(b).toBe(a);
		expect(opens).toEqual([]);
		expect(writes).toEqual([]);
	});

	test("pending ignores an id a previous grant stored", async () => {
		const { factory } = installIdb();
		const granted = await getOrCreateMemoryUserId();
		expect(await readIdbId(factory)).toBe(granted);
		setConsent("pending");
		const pending = await getOrCreateMemoryUserId();
		expect(pending).not.toBe(granted);
		// Pending does not delete what a grant stored.
		expect(await readIdbId(factory)).toBe(granted);
	});

	test("pending with IndexedDB unavailable writes nothing to localStorage", async () => {
		// biome-ignore lint/suspicious/noExplicitAny: test setup
		(globalThis as any).indexedDB = undefined;
		setConsent("pending");
		const writes = installSpyStorage();
		await getOrCreateMemoryUserId();
		expect(writes).toEqual([]);
		expect(win.localStorage.getItem(LS_KEY)).toBeNull();
	});
});

describe("getOrCreateMemoryUserId after consent is granted", () => {
	test("granting goes back to the persisted id", async () => {
		const { factory } = installIdb();
		const granted = await getOrCreateMemoryUserId();
		setConsent("pending");
		await getOrCreateMemoryUserId();
		setConsent("granted");
		expect(await getOrCreateMemoryUserId()).toBe(granted);
		expect(await readIdbId(factory)).toBe(granted);
	});
});

describe("denial deletes the stored memory user id", () => {
	test("removes the id from IndexedDB and localStorage", async () => {
		const { factory } = installIdb();
		const granted = await getOrCreateMemoryUserId();
		expect(await readIdbId(factory)).toBe(granted);
		win.localStorage.setItem(LS_KEY, "ls-id");

		setConsent("denied");
		await waitFor(async () => (await readIdbId(factory)) === undefined);
		expect(win.localStorage.getItem(LS_KEY)).toBeNull();
	});

	test("the id after a denial and a new grant is fresh", async () => {
		installIdb();
		const before = await getOrCreateMemoryUserId();
		setConsent("denied");
		await new Promise((r) => setTimeout(r, 20));
		setConsent("granted");
		const after = await getOrCreateMemoryUserId();
		expect(after).not.toBe(before);
	});

	test("a denial never creates the IndexedDB database", async () => {
		const { factory } = installIdb();
		expect(await databaseNames(factory)).not.toContain(DB_NAME);
		setConsent("denied");
		await new Promise((r) => setTimeout(r, 30));
		expect(await databaseNames(factory)).not.toContain(DB_NAME);
	});

	test("deleteStoredMemoryUserId on a missing database resolves and creates nothing", async () => {
		const { factory } = installIdb();
		await deleteStoredMemoryUserId();
		expect(await databaseNames(factory)).not.toContain(DB_NAME);
	});

	test("deleteStoredMemoryUserId removes both stores and is idempotent", async () => {
		const { factory } = installIdb();
		await getOrCreateMemoryUserId();
		win.localStorage.setItem(LS_KEY, "ls-id");
		await deleteStoredMemoryUserId();
		expect(await readIdbId(factory)).toBeUndefined();
		expect(win.localStorage.getItem(LS_KEY)).toBeNull();
		await deleteStoredMemoryUserId();
		expect(await readIdbId(factory)).toBeUndefined();
	});

	test("deleteStoredMemoryUserId never throws when both stores are unavailable", async () => {
		// biome-ignore lint/suspicious/noExplicitAny: test setup
		(globalThis as any).indexedDB = undefined;
		// biome-ignore lint/suspicious/noExplicitAny: test setup
		(globalThis as any).localStorage = {
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
		await expect(deleteStoredMemoryUserId()).resolves.toBeUndefined();
	});

	test("a denial drops the localStorage-only id when IndexedDB is unavailable", async () => {
		// biome-ignore lint/suspicious/noExplicitAny: test setup
		(globalThis as any).indexedDB = undefined;
		const granted = await getOrCreateMemoryUserId();
		expect(win.localStorage.getItem(LS_KEY)).toBe(granted);
		setConsent("denied");
		await waitFor(() => win.localStorage.getItem(LS_KEY) === null);
		setConsent("granted");
		expect(await getOrCreateMemoryUserId()).not.toBe(granted);
	});
});
