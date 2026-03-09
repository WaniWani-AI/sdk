import { describe, expect, test } from "bun:test";
import { resultProducesWidget } from "./mcp-app-frame";

describe("resultProducesWidget", () => {
	test("returns false for plain tool results with structured content but no widget metadata", () => {
		expect(
			resultProducesWidget({
				_meta: {
					some: "value",
				},
			}),
		).toBe(false);
	});

	test("returns true for MCP Apps widget metadata", () => {
		expect(
			resultProducesWidget({
				_meta: {
					ui: {
						resourceUri: "ui://widgets/ext-apps/example.html",
					},
				},
			}),
		).toBe(true);
	});

	test("returns true for OpenAI widget metadata", () => {
		expect(
			resultProducesWidget({
				_meta: {
					"openai/outputTemplate": "ui://widgets/apps-sdk/example.html",
				},
			}),
		).toBe(true);
	});
});
