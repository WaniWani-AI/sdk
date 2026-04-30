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

export async function createFlowTestHarness(
	flow: RegisteredFlow,
	options?: { stateStore?: FlowStore },
) {
	const store = options?.stateStore;
	const registered: RegisterToolArgs[] = [];
	const sessionId = `test-session-${Math.random().toString(36).slice(2, 10)}`;

	const server = {
		registerTool: (...args: unknown[]) => {
			registered.push(args as RegisterToolArgs);
		},
	} as unknown as McpServer;

	await flow.register(server);

	const handler = registered[0]?.[2];
	if (!handler) {
		throw new Error(`Flow "${flow.name}" did not register a handler`);
	}

	const extra = { _meta: { sessionId } };

	async function toResult(parsed: FlowContent): Promise<FlowTestResult> {
		return {
			...parsed,
			decodedState: store ? await store.get(sessionId) : null,
		} satisfies FlowTestResult;
	}

	return {
		async start(
			intent: string,
			stateUpdates?: Record<string, unknown>,
			context?: string,
		): Promise<FlowTestResult> {
			const result = (await handler(
				{
					action: "start",
					intent,
					...(context ? { context } : {}),
					...(stateUpdates ? { stateUpdates } : {}),
				},
				extra,
			)) as Record<string, unknown>;
			return toResult(parsePayload(result));
		},

		async continueWith(
			stateUpdates?: Record<string, unknown>,
		): Promise<FlowTestResult> {
			const result = (await handler(
				{
					action: "continue",
					...(stateUpdates ? { stateUpdates } : {}),
				},
				extra,
			)) as Record<string, unknown>;
			return toResult(parsePayload(result));
		},

		async resetWith(
			stateUpdates: Record<string, unknown>,
		): Promise<FlowTestResult> {
			const result = (await handler(
				{
					action: "reset",
					stateUpdates,
				},
				extra,
			)) as Record<string, unknown>;
			return toResult(parsePayload(result));
		},

		async lastState(): Promise<FlowTokenContent | null> {
			return store ? store.get(sessionId) : null;
		},
	};
}
