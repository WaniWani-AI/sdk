/**
 * Server-side flow state store.
 *
 * Flow state is stored via the Waniwani API, one record per flow and session
 * (see `flowStateKey`).
 * Config comes from env vars (WANIWANI_API_KEY, WANIWANI_API_URL).
 */

import { type KvStoreSetOptions, WaniwaniKvStore } from "../kv";
import type { FlowTokenContent } from "./@types";

// ============================================================================
// Interface
// ============================================================================

/**
 * The store key of one flow's record in one session. A session can run several
 * flows, and each keeps its own record, so starting a second flow never loads
 * or overwrites the first one's state.
 */
export function flowStateKey(flowId: string, sessionId: string): string {
	return `flow:${flowId}:${sessionId}`;
}

export interface FlowStore {
	get(key: string): Promise<FlowTokenContent | null>;
	set(
		key: string,
		value: FlowTokenContent,
		options?: KvStoreSetOptions,
	): Promise<void>;
	delete(key: string): Promise<void>;
}

// ============================================================================
// Waniwani API implementation
// ============================================================================

export class WaniwaniFlowStore implements FlowStore {
	private readonly store = new WaniwaniKvStore<FlowTokenContent>();

	get(key: string): Promise<FlowTokenContent | null> {
		return this.store.get(key);
	}

	set(
		key: string,
		value: FlowTokenContent,
		options?: KvStoreSetOptions,
	): Promise<void> {
		return this.store.set(key, value, options);
	}

	delete(key: string): Promise<void> {
		return this.store.delete(key);
	}
}
