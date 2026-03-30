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

/** A single turn in a multi-turn conversation. */
export interface ConversationTurn {
	input: string;
}

/** Assertion result for a single tool call check within a turn. */
export interface TurnAssertion {
	/** Whether the actual tool calls matched the expected ones. */
	passed: boolean;
	/** Expected tool names recorded in the session. */
	expected: string[];
	/** Actual tool names called during replay. */
	actual: string[];
}

/** Result of a single turn. */
export interface ConversationTurnResult {
	input: string;
	response: ChatResult;
	/** Auto-derived assertion results comparing actual vs. recorded tool calls. */
	assertions: TurnAssertion[];
}

/** Full result of a multi-turn conversation. */
export interface ConversationResult {
	turns: ConversationTurnResult[];
}

/**
 * A recorded conversation session that can be replayed as a test.
 * Messages use the AI SDK's UIMessage format — same as what the
 * Export button in the chatbar produces.
 *
 * Two replay modes:
 * - **"regenerate"** (default): Only user messages are sent.
 *   The LLM generates fresh responses at each turn. Assertions are
 *   auto-derived by comparing actual tool calls to the recorded ones.
 *
 * - **"inject"**: Prior turns are injected as-is, only the
 *   final user message gets a fresh LLM response.
 */
export interface SessionReplay {
	name: string;
	messages: UIMessage[];
	mode?: "regenerate" | "inject";
	/**
	 * Optional session-level outcome assertion.
	 * Checks that all listed tools were called at least once across the session.
	 */
	outcome?: {
		toolsCalled: string[];
	};
}

// ── Dynamic Scenario Simulation ──────────────────────────────────

/**
 * A scenario definition for dynamic multi-turn simulation.
 * An LLM user simulator plays the persona while the agent
 * tries to complete the flow through conversation.
 */
export interface Scenario {
	/** Human-readable name for this scenario. */
	name: string;
	/** Natural-language persona description fed to the user simulator LLM. */
	persona: string;
	/** The first user message that kicks off the conversation. */
	openingMessage: string;
	/** Language the simulated user speaks. */
	language: "en" | "sv" | "fr" | "de";
	/** Expected fields in the accumulated state at conversation end (for future evaluation). */
	expectedState: Record<string, unknown>;
	/** Tools that should be called at some point during the conversation (for future evaluation). */
	expectedToolsCalled?: string[];
	/** Maximum turns before considering the conversation stuck. Defaults to 15. */
	maxTurns?: number;
}

/** A single turn in a simulated conversation. */
export interface SimulationTurn {
	userMessage: string;
	assistantText: string;
	toolsCalled: string[];
	toolCallTraces: ToolCallTrace[];
}

/** Result of a dynamic scenario simulation run. */
export interface SimulationResult {
	/** Unique identifier for this simulation run. */
	id: string;
	/** Name of the scenario that was simulated. */
	scenarioName: string;
	/** Current status of the simulation. */
	status: "pending" | "running" | "completed" | "failed";
	/** All conversation turns. */
	turns: SimulationTurn[];
	/** Accumulated stateUpdates from all tool calls, deep-merged. */
	accumulatedState: Record<string, unknown>;
	/** Whether the flow reached completion. */
	completed: boolean;
	/** Total number of turns in the conversation. */
	totalTurns: number;
	/** Error message if status is "failed". */
	error?: string;
}
