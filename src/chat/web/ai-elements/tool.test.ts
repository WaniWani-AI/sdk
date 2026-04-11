import { describe, expect, test } from "bun:test";
import { resolveWidgetAutoHeight, resolveWidgetResourceUri } from "./tool";

describe("resolveWidgetResourceUri", () => {
	const definitionsWithNested = {
		"magic-8-ball": {
			_meta: {
				ui: { resourceUri: "ui://widgets/ext-apps/magic-8-ball.html" },
			},
		},
	};
	const definitionsWithFlat = {
		"magic-8-ball": {
			_meta: {
				"ui/resourceUri": "ui://widgets/ext-apps/magic-8-ball.html",
			},
		},
	};
	const definitionsWithOpenai = {
		"magic-8-ball": {
			_meta: {
				"openai/outputTemplate": "ui://widgets/apps-sdk/magic-8-ball.html",
			},
		},
	};

	test("resolves from definition `ui.resourceUri` (MCP Apps nested)", () => {
		const uri = resolveWidgetResourceUri(
			"magic-8-ball",
			{ structuredContent: { answer: "Yes" } },
			definitionsWithNested,
		);
		expect(uri).toBe("ui://widgets/ext-apps/magic-8-ball.html");
	});

	test("resolves from definition `ui/resourceUri` (MCP Apps flat)", () => {
		const uri = resolveWidgetResourceUri(
			"magic-8-ball",
			{ structuredContent: { answer: "Yes" } },
			definitionsWithFlat,
		);
		expect(uri).toBe("ui://widgets/ext-apps/magic-8-ball.html");
	});

	test("resolves from definition `openai/outputTemplate` (OpenAI Apps SDK)", () => {
		const uri = resolveWidgetResourceUri(
			"magic-8-ball",
			{ structuredContent: { answer: "Yes" } },
			definitionsWithOpenai,
		);
		expect(uri).toBe("ui://widgets/apps-sdk/magic-8-ball.html");
	});

	test("falls back to result `_meta.ui.resourceUri` when definition missing", () => {
		const uri = resolveWidgetResourceUri(
			"magic-8-ball",
			{
				_meta: {
					ui: { resourceUri: "ui://widgets/ext-apps/from-result.html" },
				},
			},
			{},
		);
		expect(uri).toBe("ui://widgets/ext-apps/from-result.html");
	});

	test("definition wins over result metadata", () => {
		const uri = resolveWidgetResourceUri(
			"magic-8-ball",
			{
				_meta: {
					ui: { resourceUri: "ui://widgets/ext-apps/from-result.html" },
				},
			},
			definitionsWithNested,
		);
		expect(uri).toBe("ui://widgets/ext-apps/magic-8-ball.html");
	});

	test("returns undefined when neither definition nor result has a URI", () => {
		const uri = resolveWidgetResourceUri(
			"magic-8-ball",
			{ structuredContent: { answer: "Yes" } },
			{},
		);
		expect(uri).toBe(undefined);
	});

	test("returns undefined when tool name is unknown and result has no _meta", () => {
		const uri = resolveWidgetResourceUri(
			"unknown-tool",
			{ structuredContent: { foo: "bar" } },
			definitionsWithNested,
		);
		expect(uri).toBe(undefined);
	});

	test("handles missing toolDefinitions map", () => {
		const uri = resolveWidgetResourceUri(
			"magic-8-ball",
			{
				_meta: {
					ui: { resourceUri: "ui://widgets/ext-apps/from-result.html" },
				},
			},
			undefined,
		);
		expect(uri).toBe("ui://widgets/ext-apps/from-result.html");
	});

	test("handles missing tool name (legacy result-only path)", () => {
		const uri = resolveWidgetResourceUri(
			undefined,
			{
				_meta: {
					ui: { resourceUri: "ui://widgets/ext-apps/from-result.html" },
				},
			},
			definitionsWithNested,
		);
		expect(uri).toBe("ui://widgets/ext-apps/from-result.html");
	});
});

describe("resolveWidgetAutoHeight", () => {
	test("returns true when definition sets autoHeight", () => {
		expect(
			resolveWidgetAutoHeight(
				"chart",
				{},
				{
					chart: {
						_meta: {
							ui: {
								resourceUri: "ui://widgets/chart.html",
								autoHeight: true,
							},
						},
					},
				},
			),
		).toBe(true);
	});

	test("returns true when result sets autoHeight (fallback)", () => {
		expect(
			resolveWidgetAutoHeight(
				"chart",
				{ _meta: { ui: { autoHeight: true } } },
				{},
			),
		).toBe(true);
	});

	test("returns false when neither source sets autoHeight", () => {
		expect(
			resolveWidgetAutoHeight(
				"chart",
				{ _meta: { ui: { resourceUri: "ui://widgets/chart.html" } } },
				{
					chart: {
						_meta: {
							ui: { resourceUri: "ui://widgets/chart.html" },
						},
					},
				},
			),
		).toBe(false);
	});
});
