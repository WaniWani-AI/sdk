/**
 * Opaque base64 token for flow state round-tripping.
 *
 * Flow state is encoded as a base64 string and included in the tool response
 * text content. The model treats it as an opaque string and passes it back
 * on the next `continue` call — no need for the model to understand or
 * reproduce the internal structure.
 */

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
	if (typeof Buffer !== "undefined") {
		return Buffer.from(json, "utf-8").toString("base64");
	}
	return btoa(json);
}

export function decodeFlowToken(token: string): FlowTokenData | null {
	try {
		let json: string;
		if (typeof Buffer !== "undefined") {
			json = Buffer.from(token, "base64").toString("utf-8");
		} else {
			json = atob(token);
		}
		return JSON.parse(json) as FlowTokenData;
	} catch {
		return null;
	}
}
