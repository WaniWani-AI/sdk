import type { UIMessage } from "ai";

export interface ToolCallTrace {
	name: string;
	input: Record<string, unknown>;
	output: unknown;
}

export interface ChatResult {
	output: string;
	toolsCalled: string[];
	toolCallTraces: ToolCallTrace[];
}

/** Assertion result for a single tool call check within a turn. */
export interface TurnAssertion {
	passed: boolean;
	expected: string[];
	actual: string[];
}

/** Result of a single turn. */
export interface ConversationTurnResult {
	input: string;
	response: ChatResult;
	assertions: TurnAssertion[];
}

/** Full result of a multi-turn conversation. */
export interface ConversationResult {
	turns: ConversationTurnResult[];
}

export type EvalScenarioType = "regulatory" | "functional" | "adversarial";

/**
 * A recorded conversation that can be replayed against an MCP server.
 *
 * Two replay modes:
 * - **"regenerate"** (default): Only user messages are sent. The LLM
 *   generates fresh responses at each turn. Assertions are auto-derived
 *   by comparing actual tool calls to the recorded ones.
 * - **"inject"**: Prior turns are injected as-is; only the final user
 *   message gets a fresh LLM response.
 */
export interface EvalScenario {
	name: string;
	type?: EvalScenarioType;
	messages: UIMessage[];
	mode?: "regenerate" | "inject";
	outcome?: {
		toolsCalled: string[];
	};
}
