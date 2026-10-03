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
import { fieldsAskedBy } from "./asked-fields";
import { isFilled } from "./execute";
import type { FlowStore } from "./flow-store";
import { expandDotPaths, getNestedValue } from "./nested";

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

	async function call(input: Record<string, unknown>): Promise<FlowContent> {
		const result = (await handler(input, extra)) as Record<string, unknown>;
		return parsePayload(result);
	}

	/**
	 * Answer each question the flow asks from `known`, the way the model
	 * answers from what the user said earlier, until the flow asks something
	 * `known` has no value for. A field is sent once: a validator that rejects
	 * it gets the rejection back, not the same value again.
	 */
	async function answerFrom(
		known: Record<string, unknown>,
		parsed: FlowContent,
	): Promise<FlowContent> {
		const values = expandDotPaths(known);
		const sent = new Set<string>();
		let current = parsed;
		for (;;) {
			const answerable = fieldsAskedBy(current).filter(
				(field) => !sent.has(field) && isFilled(getNestedValue(values, field)),
			);
			if (answerable.length === 0) {
				return current;
			}
			for (const field of answerable) {
				sent.add(field);
			}
			current = await call({
				action: "continue",
				stateUpdates: Object.fromEntries(
					answerable.map((field) => [field, getNestedValue(values, field)]),
				),
			});
		}
	}

	async function toResult(parsed: FlowContent): Promise<FlowTestResult> {
		return {
			...parsed,
			decodedState: store ? await store.get(sessionId) : null,
		} satisfies FlowTestResult;
	}

	return {
		/**
		 * Start the flow. `known` stands for what the user already said: every
		 * question whose field it holds is answered from it, and the result is
		 * the response the flow stops on.
		 */
		async start(
			intent: string,
			known?: Record<string, unknown>,
			context?: string,
		): Promise<FlowTestResult> {
			const started = await call({
				action: "start",
				intent,
				...(context ? { context } : {}),
			});
			return toResult(known ? await answerFrom(known, started) : started);
		},

		async continueWith(
			stateUpdates?: Record<string, unknown>,
		): Promise<FlowTestResult> {
			return toResult(
				await call({
					action: "continue",
					...(stateUpdates ? { stateUpdates } : {}),
				}),
			);
		},

		async resetWith(
			stateUpdates: Record<string, unknown>,
		): Promise<FlowTestResult> {
			return toResult(await call({ action: "reset", stateUpdates }));
		},

		async lastState(): Promise<FlowTokenContent | null> {
			return store ? store.get(sessionId) : null;
		},
	};
}
