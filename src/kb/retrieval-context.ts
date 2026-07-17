import { AsyncLocalStorage } from "node:async_hooks";
import type { KbSearchTrace } from "./types.js";

// Per-request bucket the tool wrapper opens; kb.search records into it.
export interface RetrievalCollector {
	searches: KbSearchTrace[];
}

// Global slot, not a module-level instance: core (kb.search) and mcp
// (withWaniwani) ship as separate bundles, so only globalThis keeps a single
// shared AsyncLocalStorage per process. Two SDK copies in one process share
// this slot, so RetrievalCollector's shape must stay backward-compatible.
const globalWithStore = globalThis as typeof globalThis & {
	__waniwaniKbRetrievalStore?: AsyncLocalStorage<RetrievalCollector>;
};

let store = globalWithStore.__waniwaniKbRetrievalStore;
if (!store) {
	store = new AsyncLocalStorage<RetrievalCollector>();
	globalWithStore.__waniwaniKbRetrievalStore = store;
}
export const retrievalCollectorStore = store;

export function recordKbSearch(trace: KbSearchTrace): void {
	retrievalCollectorStore.getStore()?.searches.push(trace);
}
