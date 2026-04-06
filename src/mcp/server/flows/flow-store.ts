/**
 * Server-side flow state store.
 *
 * Flow state is stored via the WaniWani API, keyed by session ID.
 * Config comes from env vars (WANIWANI_API_KEY, WANIWANI_API_URL).
 */

import { WaniwaniKvStore } from "../kv";
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
	private readonly store = new WaniwaniKvStore<FlowTokenContent>();

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
