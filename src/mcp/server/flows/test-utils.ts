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

export async function createFlowTestHarness(flow: RegisteredFlow) {
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

	function toResult(parsed: FlowContent): FlowTestResult {
		lastFlowToken = parsed.flowToken;
		return {
			...parsed,
			decodedState: lastFlowToken ? decodeFlowToken(lastFlowToken) : null,
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

		lastState(): FlowTokenContent | null {
			if (!lastFlowToken) return null;
			return decodeFlowToken(lastFlowToken);
		},
	};
}
