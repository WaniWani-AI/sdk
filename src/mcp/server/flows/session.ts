import type { FlowTokenContent, FlowToolInput } from "./@types";
import type { FlowStore } from "./flow-store";
import { decodeFlowToken } from "./flow-token";

const SESSION_ID_KEYS = [
	"openai/sessionId",
	"sessionId",
	"conversationId",
	"anthropic/sessionId",
] as const;

export function extractSessionId(
	meta: Record<string, unknown> | undefined,
): string | undefined {
	if (!meta) return undefined;
	for (const key of SESSION_ID_KEYS) {
		const value = meta[key];
		if (typeof value === "string" && value.length > 0) return value;
	}
	return undefined;
}

export async function getFlowTokenContent(
	args: FlowToolInput,
	store: FlowStore,
	sessionId: string | undefined,
): Promise<FlowTokenContent | null> {
	// Primary: look up by session ID — no LLM round-tripping
	if (sessionId) {
		const stored = await store.get(sessionId);
		if (stored) return stored;
	}

	// Fallback: flowToken is either a store key (short hex) or a legacy base64 token
	if (args.flowToken) {
		const stored = await store.get(args.flowToken);
		if (stored) return stored;
		const decoded = decodeFlowToken(args.flowToken);
		if (decoded) return decoded;
	}

	return null;
}
