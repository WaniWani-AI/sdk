import type { FlowTokenContent, FlowToolInput } from "./@types";
import type { FlowStore } from "./flow-store";
import { decodeFlowToken } from "./flow-token";

export async function getFlowTokenContent(
	args: FlowToolInput,
	store: FlowStore,
	sessionId: string | undefined,
): Promise<FlowTokenContent | null> {
	// Primary: look up by session ID — no LLM round-tripping
	if (sessionId) {
		const stored = await store.get(sessionId);
		if (stored) {
			return stored;
		}
	}

	// Fallback: flowToken is either a store key (short hex) or a legacy base64 token
	if (args.flowToken) {
		const stored = await store.get(args.flowToken);
		if (stored) {
			return stored;
		}
		const decoded = decodeFlowToken(args.flowToken);
		if (decoded) {
			return decoded;
		}
	}

	return null;
}
