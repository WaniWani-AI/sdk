import { defineTool } from "@waniwani/kit";
import { z } from "zod";
import { buildPlans } from "../lib/plans.js";

export default defineTool({
	title: "Check instalment eligibility",
	description:
		"Work out which instalment plans a basket qualifies for, and what each one costs per month. Call this before showing any plans, and before quoting any figure — never do the arithmetic yourself. Takes the basket total in euros.",
	input: {
		amount: z.number().positive().describe("Basket total in euros, e.g. 249.90"),
		country: z
			.enum(["FR", "ES", "PT"])
			.default("FR")
			.describe("Country the shopper is buying from."),
	},
	output: {
		eligible: z.boolean(),
		reason: z.string().optional(),
		plans: z.array(
			z.object({
				id: z.string(),
				instalments: z.number(),
				monthly: z.number(),
				fee: z.number(),
				total: z.number(),
			}),
		),
	},
	hints: { readOnly: true },
	run: ({ amount, country }) => {
		if (amount < 50) {
			return {
				eligible: false,
				reason: "Baskets under €50 cannot be split.",
				plans: [],
			};
		}
		if (amount > 3000) {
			return {
				eligible: false,
				reason: "Baskets over €3,000 need a full credit application.",
				plans: [],
			};
		}

		return {
			eligible: true,
			plans: buildPlans(amount, country).map((plan) => ({
				id: plan.id,
				instalments: plan.instalments,
				monthly: plan.monthly,
				fee: plan.fee,
				total: plan.total,
			})),
		};
	},
});
