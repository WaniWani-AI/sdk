import type { z } from "zod";
import type { FlowConfig, InferFlowState } from "./@types";
import { StateGraph } from "./state-graph";

/**
 * Create a new flow graph — convenience factory for `new StateGraph()`.
 *
 * The state type is automatically inferred from the `state` definition —
 * no explicit generic parameter needed.
 *
 * @example
 * ```ts
 * import { createFlow, interrupt, START, END } from "@waniwani/sdk/mcp";
 * import { z } from "zod";
 *
 * const flow = createFlow({
 *   id: "onboarding",
 *   title: "User Onboarding",
 *   description: "Guides users through onboarding. Use when a user wants to get started.",
 *   state: {
 *     name: z.string().describe("The user's name"),
 *     email: z.string().describe("The user's email address"),
 *   },
 * })
 *   .addNode("ask_name", () => interrupt({ question: "What's your name?", field: "name" }))
 *   .addNode("ask_email", () => interrupt({ question: "What's your email?", field: "email" }))
 *   .addEdge(START, "ask_name")
 *   .addEdge("ask_name", "ask_email")
 *   .addEdge("ask_email", END)
 *   .compile();
 * ```
 */
export function createFlow<const TSchema extends Record<string, z.ZodType>>(
	config: Omit<FlowConfig, "state"> & { state: TSchema },
): StateGraph<InferFlowState<TSchema>> {
	return new StateGraph<InferFlowState<TSchema>>(config);
}
