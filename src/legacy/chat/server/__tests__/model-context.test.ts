import { describe, expect, test } from "bun:test";

import { applyModelContextToSystemPrompt } from "../model-context";

describe("applyModelContextToSystemPrompt", () => {
	test("returns original system prompt when no model context is present", () => {
		expect(applyModelContextToSystemPrompt("Base prompt", undefined)).toBe(
			"Base prompt",
		);
	});

	test("appends widget-provided model context for the next turn", () => {
		const result = applyModelContextToSystemPrompt("Base prompt", {
			content: [
				{
					type: "text",
					text: "Continue the flow.",
				},
			],
			structuredContent: {
				flow: {
					tool: "demo_flow",
					input: {
						action: "continue",
					},
				},
			},
		});

		expect(result).toContain("Base prompt");
		expect(result).toContain("Widget Model Context");
		expect(result).toContain("Continue the flow.");
		expect(result).toContain('"tool": "demo_flow"');
	});
});
