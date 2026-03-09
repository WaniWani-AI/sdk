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
					text: "Continue the flow with the provided flowToken.",
				},
			],
			structuredContent: {
				flow: {
					tool: "demo_flow",
					input: {
						action: "continue",
						flowToken: "abc123",
					},
				},
			},
		});

		expect(result).toContain("Base prompt");
		expect(result).toContain("Widget Model Context");
		expect(result).toContain("Continue the flow with the provided flowToken.");
		expect(result).toContain('"tool": "demo_flow"');
		expect(result).toContain('"flowToken": "abc123"');
	});
});
