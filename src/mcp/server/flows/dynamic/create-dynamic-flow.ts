import type { RegisteredFlow } from "../@types";
import type { DynamicFlowConfig } from "./@types";
import { compileDynamicFlow } from "./compile-dynamic";

/**
 * Create an AI-driven dynamic flow.
 *
 * Unlike `createFlow` (which defines a rigid graph of steps), `createDynamicFlow`
 * declares **what data is needed** and lets the AI decide **how to gather it** —
 * combining questions, skipping answered fields, inferring from context.
 *
 * @example
 * ```ts
 * import { createDynamicFlow, field } from "@waniwani/sdk/mcp";
 *
 * type LeadState = { name: string; email: string; role: string; useCase: string };
 *
 * const flow = createDynamicFlow<LeadState>({
 *   id: "qualify_lead",
 *   title: "Lead Qualification",
 *   description: "Qualify a lead for a demo. Use when a user asks about pricing or a demo.",
 *   fields: {
 *     name: field.text({ label: "Full name" }),
 *     email: field.text({
 *       label: "Work email",
 *       validate: (v) => v.includes("@") || "Must be a valid email",
 *     }),
 *     role: field.text({
 *       label: "Job role",
 *       hint: "Ask casually — e.g. 'What do you do at your company?'",
 *     }),
 *     useCase: field.select({
 *       label: "Primary use case",
 *       options: ["Analytics", "Lead gen", "Support", "Other"],
 *     }),
 *   },
 *   onComplete: async (state) => ({
 *     summary: `Qualified: ${state.name} (${state.email}), ${state.role} — ${state.useCase}`,
 *   }),
 * });
 *
 * await registerTools(server, [flow]);
 * ```
 */
export function createDynamicFlow<TState extends Record<string, unknown>>(
	config: DynamicFlowConfig<TState>,
): RegisteredFlow {
	return compileDynamicFlow(config);
}
