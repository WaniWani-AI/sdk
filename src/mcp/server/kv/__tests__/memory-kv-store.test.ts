import { describe, expect, test } from "bun:test";
import { MemoryKvStore } from "../memory-kv-store";

describe("MemoryKvStore", () => {
	test("get returns null for missing key", async () => {
		const store = new MemoryKvStore();
		expect(await store.get("missing")).toBeNull();
	});

	test("round-trips a value", async () => {
		const store = new MemoryKvStore<{ count: number }>();
		await store.set("foo", { count: 42 });
		expect(await store.get("foo")).toEqual({ count: 42 });
	});

	test("overwrites existing values", async () => {
		const store = new MemoryKvStore<{ v: number }>();
		await store.set("k", { v: 1 });
		await store.set("k", { v: 2 });
		expect(await store.get("k")).toEqual({ v: 2 });
	});

	test("delete removes a value", async () => {
		const store = new MemoryKvStore();
		await store.set("k", { x: 1 });
		await store.delete("k");
		expect(await store.get("k")).toBeNull();
	});

	test("delete on missing key is a no-op", async () => {
		const store = new MemoryKvStore();
		await expect(store.delete("missing")).resolves.toBeUndefined();
	});

	test("isolated instances do not share state", async () => {
		const a = new MemoryKvStore<{ v: number }>();
		const b = new MemoryKvStore<{ v: number }>();
		await a.set("k", { v: 1 });
		expect(await b.get("k")).toBeNull();
	});
});
