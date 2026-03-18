// Request Context — AsyncLocalStorage-based meta propagation
//
// withWaniwani populates this during each tool execution so that
// wani.track(), wani.identify(), etc. auto-attach session metadata.

import { AsyncLocalStorage } from "node:async_hooks";

export interface RequestContext {
	meta: Record<string, unknown>;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();

/**
 * Returns the meta from the current request context, or undefined
 * if called outside of a withWaniwani-wrapped handler.
 */
export function getRequestMeta(): Record<string, unknown> | undefined {
	return requestContext.getStore()?.meta;
}
