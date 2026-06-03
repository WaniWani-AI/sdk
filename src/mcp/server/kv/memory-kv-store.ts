/**
 * In-memory KvStore implementation.
 *
 * State lives in a `Map` for the lifetime of the process — nothing is
 * persisted, nothing is shared across instances. Use for local development
 * and tests. For production, plug in a Redis/Upstash/CF-KV adapter or set
 * `WANIWANI_API_KEY` to use the hosted store.
 */

import type { KvStore, KvStoreSetOptions } from "./kv-store";

export class MemoryKvStore<T = Record<string, unknown>> implements KvStore<T> {
	private readonly map = new Map<string, T>();

	async get(key: string): Promise<T | null> {
		return this.map.get(key) ?? null;
	}

	// In-memory storage has no expiry; `options` (e.g. `ttlSeconds`) is accepted
	// for parity with WaniwaniKvStore but ignored.
	async set(
		key: string,
		value: T,
		_options?: KvStoreSetOptions,
	): Promise<void> {
		this.map.set(key, value);
	}

	async delete(key: string): Promise<void> {
		this.map.delete(key);
	}
}
