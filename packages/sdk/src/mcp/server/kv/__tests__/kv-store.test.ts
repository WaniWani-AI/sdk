import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { WaniwaniKvStore } from "../kv-store";

// Captures the request the store sends so we can assert how `ttlSeconds`
// (Redis-style TTL) is forwarded to /api/mcp/redis/set.

const realFetch = globalThis.fetch;

let captured: { url: string; body: Record<string, unknown> } | null = null;

beforeEach(() => {
	process.env.WANIWANI_API_KEY = "wwk_test";
	delete process.env.WANIWANI_API_URL;
	delete process.env.WANIWANI_ENCRYPTION_KEY;
	captured = null;
	globalThis.fetch = (async (input: string, init: RequestInit) => {
		captured = { url: String(input), body: JSON.parse(String(init.body)) };
		return new Response(JSON.stringify({ data: { ok: true } }), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});
	}) as typeof fetch;
});

afterEach(() => {
	globalThis.fetch = realFetch;
});

describe("WaniwaniKvStore TTL", () => {
	test("forwards ttlSeconds to /api/mcp/redis/set when provided", async () => {
		const store = new WaniwaniKvStore();
		const sevenDays = 7 * 24 * 60 * 60;

		await store.set("k", { a: 1 }, { ttlSeconds: sevenDays });

		expect(captured?.url).toBe("https://app.waniwani.ai/api/mcp/redis/set");
		expect(captured?.body).toEqual({
			key: "k",
			value: { a: 1 },
			ttlSeconds: sevenDays,
		});
	});

	test("omits ttlSeconds when not provided (server applies its default)", async () => {
		const store = new WaniwaniKvStore();

		await store.set("k", { a: 1 });

		expect(captured?.body).toEqual({ key: "k", value: { a: 1 } });
		expect(captured?.body && "ttlSeconds" in captured.body).toBe(false);
	});
});
