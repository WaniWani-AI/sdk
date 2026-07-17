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

// Best-effort: recording runs inside kb.search(), so it must never throw back
// into a user's search (e.g. a corrupted collector from a mixed SDK version).
export function recordKbSearch(trace: KbSearchTrace): void {
	try {
		retrievalCollectorStore.getStore()?.searches.push(trace);
	} catch {}
}
