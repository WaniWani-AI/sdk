/**
 * Opaque compressed token for flow state round-tripping.
 *
 * Flow state is compressed (zlib deflate) then base64-encoded. This produces
 * a token that:
 * 1. Looks like random noise — models can't mentally decode it
 * 2. Is smaller than raw base64 (~30% compression on typical state)
 * 3. The model treats it as an opaque string and passes it back unchanged
 *
 * Only encoded/decoded on the server (Node.js). Browser code should never
 * need to decode flow tokens.
 */

import { deflateSync, inflateSync } from "node:zlib";

export type FlowTokenData = {
	step: string;
	state: Record<string, unknown>;
	field?: string;
	widgetId?: string;
	questions?: Array<{
		question: string;
		field: string;
		suggestions?: string[];
		context?: string;
	}>;
	interruptContext?: string;
};

export function encodeFlowToken(data: FlowTokenData): string {
	const json = JSON.stringify(data);
	const compressed = deflateSync(json);
	return compressed.toString("base64");
}

export function decodeFlowToken(token: string): FlowTokenData | null {
	try {
		const compressed = Buffer.from(token, "base64");
		const json = inflateSync(compressed).toString("utf-8");
		return JSON.parse(json) as FlowTokenData;
	} catch {
		return null;
	}
}
