import { beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";

const win = new Window({ url: "https://localhost" });
for (const key of [
	"document",
	"navigator",
	"localStorage",
	"indexedDB",
	"IDBKeyRange",
] as const) {
	// biome-ignore lint/suspicious/noExplicitAny: test setup
	(globalThis as any)[key] = (win as any)[key];
}
// biome-ignore lint/suspicious/noExplicitAny: test setup
(globalThis as any).window = win;

async function freshModule() {
	const mod = await import(
		`../memory-user-id?t=${Date.now()}-${Math.random()}`
	);
	return mod as typeof import("../memory-user-id");
}

beforeEach(() => {
	try {
		localStorage.clear();
	} catch {
		// ignore
	}
});

describe("getOrCreateMemoryUserId", () => {
	test("generates and persists a UUID on first call", async () => {
		const mod = await freshModule();
		const id = await mod.getOrCreateMemoryUserId();
		expect(typeof id).toBe("string");
		expect(id.length).toBeGreaterThan(10);
	});

	test("returns the same UUID on subsequent calls in the same session", async () => {
		const mod = await freshModule();
		const a = await mod.getOrCreateMemoryUserId();
		const b = await mod.getOrCreateMemoryUserId();
		expect(a).toBe(b);
	});

	test("falls back to localStorage when indexedDB is unavailable", async () => {
		const realIdb = (globalThis as unknown as { indexedDB: unknown }).indexedDB;
		// biome-ignore lint/suspicious/noExplicitAny: test setup
		(globalThis as any).indexedDB = undefined;
		try {
			const mod = await freshModule();
			const id = await mod.getOrCreateMemoryUserId();
			expect(typeof id).toBe("string");
			expect(localStorage.getItem("waniwani-memory-user-id")).toBe(id);
		} finally {
			// biome-ignore lint/suspicious/noExplicitAny: test setup
			(globalThis as any).indexedDB = realIdb;
		}
	});

	test("returns in-memory UUID when both storage layers fail", async () => {
		const realIdb = (globalThis as unknown as { indexedDB: unknown }).indexedDB;
		const realLs = (globalThis as unknown as { localStorage: unknown })
			.localStorage;
		// biome-ignore lint/suspicious/noExplicitAny: test setup
		(globalThis as any).indexedDB = undefined;
		const throwingStorage = {
			getItem: () => {
				throw new Error("blocked");
			},
			setItem: () => {
				throw new Error("blocked");
			},
			removeItem: () => {},
			clear: () => {},
			key: () => null,
			length: 0,
		};
		// biome-ignore lint/suspicious/noExplicitAny: test setup
		(globalThis as any).localStorage = throwingStorage;
		try {
			const mod = await freshModule();
			const a = await mod.getOrCreateMemoryUserId();
			const b = await mod.getOrCreateMemoryUserId();
			expect(typeof a).toBe("string");
			expect(a).toBe(b);
		} finally {
			// biome-ignore lint/suspicious/noExplicitAny: test setup
			(globalThis as any).indexedDB = realIdb;
			// biome-ignore lint/suspicious/noExplicitAny: test setup
			(globalThis as any).localStorage = realLs;
		}
	});
});
