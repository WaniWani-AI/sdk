import { beforeEach, describe, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { Window } from "happy-dom";

const win = new Window({ url: "https://localhost" });
for (const key of ["localStorage", "sessionStorage"] as const) {
	// biome-ignore lint/suspicious/noExplicitAny: test setup
	(globalThis as any)[key] = (win as any)[key];
}

beforeEach(() => {
	// biome-ignore lint/suspicious/noExplicitAny: test setup, a fresh empty IndexedDB per case
	(globalThis as any).indexedDB = new IDBFactory();
	localStorage.clear();
	sessionStorage.clear();
});

async function freshModule() {
	return (await import(
		`../legacy-storage?t=${Date.now()}-${Math.random()}`
	)) as typeof import("../legacy-storage");
}

async function databaseNames(): Promise<string[]> {
	return (await indexedDB.databases()).map((d) => d.name ?? "");
}

async function createDatabase(name: string): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		const req = indexedDB.open(name, 1);
		req.onsuccess = () => {
			req.result.close();
			resolve();
		};
		req.onerror = () => reject(req.error);
	});
}

async function settle(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 20));
}

describe("removeLegacyStorage", () => {
	test("deletes every key older releases wrote and keeps the current ones", async () => {
		localStorage.setItem("waniwani-memory-user-id", "old");
		localStorage.setItem("waniwani:eve-conversation:chan_1", "{}");
		localStorage.setItem("waniwani:eve-conversation:chan_1:t1", "{}");
		localStorage.setItem("waniwani-visitor-id", "keep");
		localStorage.setItem("WANIWANI_DEBUG", "1");
		localStorage.setItem("host-key", "keep");
		sessionStorage.setItem("waniwani:config:https://a|wwp_1|", "{}");
		sessionStorage.setItem("waniwani:webmcp:session", "old");
		sessionStorage.setItem("waniwani-config", "{}");
		sessionStorage.setItem("waniwani-session", "{}");

		(await freshModule()).removeLegacyStorage();

		const localKeys = Array.from({ length: localStorage.length }, (_, i) =>
			localStorage.key(i),
		).sort();
		const sessionKeys = Array.from({ length: sessionStorage.length }, (_, i) =>
			sessionStorage.key(i),
		).sort();
		expect(localKeys).toEqual([
			"WANIWANI_DEBUG",
			"host-key",
			"waniwani-visitor-id",
		]);
		expect(sessionKeys).toEqual(["waniwani-config", "waniwani-session"]);
	});

	test("deletes the old waniwani-memory database and keeps waniwani-threads", async () => {
		await createDatabase("waniwani-memory");
		await createDatabase("waniwani-threads");

		(await freshModule()).removeLegacyStorage();
		await settle();

		expect(await databaseNames()).toEqual(["waniwani-threads"]);
	});

	test("creates no database when there is none", async () => {
		(await freshModule()).removeLegacyStorage();
		await settle();

		expect(await databaseNames()).toEqual([]);
	});
});
