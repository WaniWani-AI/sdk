// Internal SDK surface, mounted at `@waniwani/sdk/internal`. NOT part of the
// public API — this entry point exists for the Waniwani platform (the app at
// app.waniwani.ai) to reuse SDK primitives that are not appropriate for
// third-party consumers.
//
// Do not document these in user-facing docs. Do not export them from the
// public `@waniwani/sdk` or `@waniwani/sdk/mcp` entry points.
//
// Things mounted here:
// - replayScenario: replay a recorded UIMessage conversation against an
//   MCP-backed chat server. Used by the compliance/evals features in the app.

export { replayScenario } from "./replay-scenario";
export type {
	ChatResult,
	ConversationResult,
	ConversationTurnResult,
	EvalScenario,
	EvalScenarioType,
	ToolCallTrace,
	TurnAssertion,
} from "./types";
