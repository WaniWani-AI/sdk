import { defineTool } from "@waniwani/kit";
import { z } from "zod";

/**
 * The filename is the tool name, so this file is `search-products`. Rename the
 * file and the tool renames with it.
 *
 * Swap CATALOGUE for whatever answers the question for real: a fetch, a
 * database, an internal API. `run` may be async.
 */
const CATALOGUE = [
	{
		id: "aeron",
		name: "Aeron chair",
		price: 1290,
		blurb: "Mesh task chair, twelve-year warranty.",
	},
	{ id: "sayl", name: "Sayl chair", price: 545, blurb: "Suspension back, the light one." },
	{ id: "nevi", name: "Nevi sit-stand desk", price: 890, blurb: "Electric, 70 to 120 cm." },
	{ id: "ollin", name: "Ollin monitor arm", price: 235, blurb: "Single arm, holds up to 9 kg." },
];

export default defineTool({
	// Shown to humans in connector UIs.
	title: "Search the catalogue",
	// The only thing the model reads before deciding to call this, so it says
	// when to call it and what not to do instead.
	description:
		"Find products matching what the shopper asked for. Call this before naming any product or quoting any price, and never answer either from memory. Pass the shopper's own words as the query.",
	// Zod shapes, written as plain objects instead of z.object({ ... }).
	input: {
		query: z
			.string()
			.describe("What the shopper asked for, in their words, e.g. 'a chair under 600'."),
	},
	output: {
		products: z.array(
			z.object({
				id: z.string(),
				name: z.string(),
				price: z.number().describe("Price in euros."),
				blurb: z.string(),
			}),
		),
	},
	// Becomes MCP annotations. This tool reads and does nothing else.
	hints: { readOnly: true },
	run: ({ query }) => {
		const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
		const matched = CATALOGUE.filter((product) =>
			terms.some((term) => `${product.name} ${product.blurb}`.toLowerCase().includes(term)),
		);
		// The whole catalogue when nothing matched, so an early conversation has
		// something on screen while you are still wiring this up.
		return { products: matched.length > 0 ? matched : CATALOGUE };
	},
});
