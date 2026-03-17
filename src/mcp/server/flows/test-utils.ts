import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
	FlowCompleteContent,
	FlowContent,
	FlowErrorContent,
	FlowInterruptContent,
	FlowTokenContent,
	FlowWidgetContent,
	RegisteredFlow,
} from "./@types";
import type { FlowStore } from "./flow-store";
import { decodeFlowToken } from "./flow-token";

// ============================================================================
// Test harness for compiled flows
// ============================================================================

type WithDecodedState = { decodedState: FlowTokenContent | null };

export type FlowTestResult =
	| (FlowInterruptContent & WithDecodedState)
	| (FlowWidgetContent & WithDecodedState)
	| (FlowCompleteContent & WithDecodedState)
	| (FlowErrorContent & WithDecodedState);

type Handler = (input: unknown, extra: unknown) => Promise<unknown>;
type RegisterToolArgs = [string, Record<string, unknown>, Handler];

function parsePayload(result: Record<string, unknown>): FlowContent {
	const content = result.content as Array<{ type: string; text?: string }>;
	return JSON.parse(content[0]?.text ?? "") as FlowContent;
}

async function resolveState(
	token: string | undefined,
	store?: FlowStore,
): Promise<FlowTokenContent | null> {
	if (!token) return null;

	// Try server-side store first (short key)
	if (store) {
		const stored = await store.get(token);
		if (stored) return stored;
	}

	// Fallback: legacy compressed base64 token
	return decodeFlowToken(token);
}

export async function createFlowTestHarness(
	flow: RegisteredFlow,
	options?: { stateStore?: FlowStore },
) {
	const store = options?.stateStore;
	const registered: RegisterToolArgs[] = [];

	// We don't need to implement the server, we just need to register the tool
	const server = {
		registerTool: (...args: unknown[]) => {
			registered.push(args as RegisterToolArgs);
		},
	} as unknown as McpServer;

	await flow.register(server);

	const handler = registered[0]?.[2];
	if (!handler) throw new Error(`Flow "${flow.id}" did not register a handler`);

	let lastFlowToken: string | undefined;

	async function toResult(parsed: FlowContent): Promise<FlowTestResult> {
		lastFlowToken = parsed.flowToken;
		return {
			...parsed,
			decodedState: await resolveState(lastFlowToken, store),
		} satisfies FlowTestResult;
	}

	return {
		async start(
			stateUpdates?: Record<string, unknown>,
		): Promise<FlowTestResult> {
			const result = (await handler(
				{ action: "start", ...(stateUpdates ? { stateUpdates } : {}) },
				{},
			)) as Record<string, unknown>;
			return toResult(parsePayload(result));
		},

		async continueWith(
			stateUpdates?: Record<string, unknown>,
		): Promise<FlowTestResult> {
			if (!lastFlowToken) throw new Error("No flowToken — call start() first");
			const result = (await handler(
				{
					action: "continue",
					flowToken: lastFlowToken,
					...(stateUpdates ? { stateUpdates } : {}),
				},
				{},
			)) as Record<string, unknown>;
			return toResult(parsePayload(result));
		},

		async lastState(): Promise<FlowTokenContent | null> {
			return resolveState(lastFlowToken, store);
		},
	};
}
