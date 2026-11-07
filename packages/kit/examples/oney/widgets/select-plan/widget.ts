import { defineWidget } from "@waniwani/kit";
import { z } from "zod";

const plan = z.object({
	id: z.string().describe("Plan id, e.g. 'x3'."),
	label: z.string().describe("Short label, e.g. '3×'."),
	instalments: z.number(),
	monthly: z.number().describe("Amount due each month, in euros."),
	fee: z.number().describe("Total fee in euros. 0 for interest-free plans."),
	total: z.number().describe("Total repaid, in euros."),
	tagline: z.string(),
});

/**
 * One schema for the tool input, the structured output, and the component's
 * props. Server and UI cannot drift.
 */
export default defineWidget({
	title: "Choose an instalment plan",
	description:
		"Show the instalment plan picker. Call this once check_eligibility has returned plans, passing them straight through. Frame it in one warm sentence before calling, e.g. 'Here's how you could split it — pick whichever suits you.' The widget renders every figure itself: do NOT list the plans, monthly amounts, or fees in text.",
	data: {
		amount: z.number().describe("Basket total in euros."),
		merchant: z.string().optional().describe("Merchant name, when known."),
		plans: z.array(plan).describe("Plans returned by check_eligibility, unmodified."),
		selectedPlanId: z
			.string()
			.optional()
			.describe("Pre-selected plan id. Leave unset unless the user already chose one."),
	},
	hints: { readOnly: true },
	llmText: (data) =>
		`The instalment picker is now on screen with ${data.plans.length} plans for €${data.amount}. It renders every figure itself — do NOT repeat the plans, monthly amounts, or fees in text.

Wait for the user to pick a card or name a plan. When they do, confirm it in one short sentence and add the affordability line: "Borrowing money costs money too. Check your repayment capacity before you commit."`,
});
