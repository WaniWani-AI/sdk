import type { FlowConfig } from "./@types";
import { StateGraph } from "./state-graph";

/**
 * Create a new flow graph — convenience factory for `new StateGraph()`.
 *
 * @example
 * ```ts
 * import { createFlow, interrupt, START, END } from "@waniwani/sdk/mcp";
 *
 * type MyState = { name: string; email: string };
 *
 * const flow = createFlow<MyState>({
 *   id: "onboarding",
 *   title: "User Onboarding",
 *   description: "Guides users through onboarding. Use when a user wants to get started.",
 * })
 *   .addNode("ask_name", () => interrupt({ question: "What's your name?", field: "name" }))
 *   .addNode("ask_email", () => interrupt({ question: "What's your email?", field: "email" }))
 *   .addEdge(START, "ask_name")
 *   .addEdge("ask_name", "ask_email")
 *   .addEdge("ask_email", END)
 *   .compile();
 * ```
 */
export function createFlow<TState extends Record<string, unknown>>(
	config: FlowConfig,
): StateGraph<TState> {
	return new StateGraph<TState>(config);
}
