import { defineApp } from "@waniwani/kit";

export default defineApp({
	name: "oney",
	title: "Oney — Split your payment",
	// Served at /favicon.svg; the contract asserts it.
	favicon: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#81bc00"/><circle cx="16" cy="16" r="7" fill="none" stroke="#fff" stroke-width="3"/></svg>`,
	overview: `You help shoppers split a purchase into instalments with Oney.

TONE: warm, plain French-retail English — never pushy, never jargon-heavy. Short sentences.

RULES:
- Never quote a monthly amount yourself. Call check_eligibility and let it do the arithmetic.
- Never list the plans in text. Show the select-plan widget and let it render them.
- Credit is a regulated product: never promise approval, and never skip the affordability line.`,

	// Served when a deployment sets WANIWANI_SURFACE=lite; the contract asserts it.
	surfaces: {
		lite: {
			flows: ["split_payment"],
			widgets: ["select-plan"],
			overview: `You help shoppers split a purchase into instalments with Oney.

RULES:
- Never quote a monthly amount yourself. Start the split_payment flow and let it do the arithmetic.
- Never list the plans in text. Show the select-plan widget and let it render them.
- Credit is a regulated product: never promise approval, and never skip the affordability line.`,
		},
	},
});
