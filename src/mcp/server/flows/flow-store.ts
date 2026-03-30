/**
 * Server-side flow state store.
 *
 * Flow state is stored via the WaniWani API, keyed by session ID.
 * The session ID comes from _meta (provided by the MCP client on every call),
 * so the LLM doesn't need to round-trip anything.
 *
 * Tenant isolation is handled by the API key — no manual key prefixing needed.
 *
 * The `FlowStore` interface is exported for custom implementations.
 */

import { type KvStoreOptions, WaniwaniKvStore } from "../kv";
import type { FlowTokenContent } from "./@types";

// ============================================================================
// Interface
// ============================================================================

export interface FlowStore {
	get(key: string): Promise<FlowTokenContent | null>;
	set(key: string, value: FlowTokenContent): Promise<void>;
	delete(key: string): Promise<void>;
}

// ============================================================================
// WaniWani API implementation
// ============================================================================

export class WaniwaniFlowStore implements FlowStore {
	private readonly store: WaniwaniKvStore<FlowTokenContent>;

	constructor(options?: KvStoreOptions) {
		this.store = new WaniwaniKvStore<FlowTokenContent>(options);
	}

	get(key: string): Promise<FlowTokenContent | null> {
		return this.store.get(key);
	}

	set(key: string, value: FlowTokenContent): Promise<void> {
		return this.store.set(key, value);
	}

	delete(key: string): Promise<void> {
		return this.store.delete(key);
	}
}
