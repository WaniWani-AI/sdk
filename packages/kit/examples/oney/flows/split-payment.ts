import { createFlow, END, MemoryKvStore, START } from "@waniwani/sdk/mcp";
import { z } from "zod";
import { buildPlans } from "../lib/plans.js";

/**
 * A flow is an SDK primitive, used here unchanged. The runtime registers
 * whatever `compile()` returns — no wrapper, no adapter.
 */
export default createFlow({
	id: "split_payment",
	title: "Split a payment into instalments",
	description:
		"Guide a shopper through splitting a purchase into instalments. Use whenever someone asks to pay later, pay in instalments, spread the cost, or mentions Oney.",
	annotations: {
		title: "Split a payment into instalments",
		readOnlyHint: true,
		openWorldHint: false,
		destructiveHint: false,
	},
	state: {
		amount: z.number().describe("Basket total in euros. Extract any figure the shopper mentions."),
		country: z
			.enum(["FR", "ES", "PT"])
			.describe("Country the shopper is buying from. Default to FR unless they say otherwise."),
		selectedPlanId: z
			.string()
			.describe("The plan the shopper picked from the widget. Do NOT set this yourself."),
	},
})
	.addNode({
		id: "ask_amount",
		run: ({ interrupt }) =>
			interrupt({
				amount: {
					question: "How much is the basket?",
					context: `Open warmly and ask ONE question: how much they're looking to split. Do not list plans, do not quote figures, do not ask for anything else yet.

If they mention a country or currency, extract country too.`,
				},
			}),
	})
	.addNode({
		id: "show_plans",
		run: ({ state, showWidget }) =>
			showWidget({
				tool: "select-plan",
				field: "selectedPlanId",
				data: {
					amount: state.amount ?? 0,
					plans: buildPlans(state.amount ?? 0, state.country ?? "FR"),
				},
			}),
	})
	.addEdge(START, "ask_amount")
	.addEdge("ask_amount", "show_plans")
	.addEdge("show_plans", END)
	// No API key needed to run this locally.
	.compile({ store: new MemoryKvStore() });
