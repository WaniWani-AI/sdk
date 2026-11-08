import { defineWidget } from "@waniwani/kit";
import { z } from "zod";

const product = z.object({
	id: z.string(),
	name: z.string(),
	price: z.number().describe("Price in euros."),
	blurb: z.string().describe("One line about the product."),
});

/**
 * The folder name is the tool name, so this widget is `product-list`.
 *
 * `data` is one schema doing three jobs: the tool's input, its structured
 * output, and the props `useWidget()` hands ui.tsx. Server and UI cannot drift.
 *
 * This file is imported by the server and by the browser bundle, so it stays
 * free of React and CSS. The component sits next to it in ui.tsx.
 */
export default defineWidget({
	title: "Product list",
	description:
		'Show the product cards. Call this once search-products has returned products, passing them through unmodified. Frame it in one short sentence before calling, e.g. "Here\'s what fits." The widget renders every name and price itself, so do NOT list them in text.',
	data: {
		query: z.string().describe("What the shopper asked for. Shown as the heading."),
		products: z.array(product).describe("Products returned by search-products, unmodified."),
	},
	hints: { readOnly: true },
	// Text handed to the model alongside the rendered widget. Use it to say what
	// the model should not repeat, and what it should wait for.
	llmText: (data) =>
		`The product list is on screen with ${data.products.length} products. It renders every name and price itself, so do NOT repeat them in text.

Wait for the shopper to pick one, then answer about that product.`,
});
