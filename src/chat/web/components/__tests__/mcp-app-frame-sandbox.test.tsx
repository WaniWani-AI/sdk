import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { McpAppFrame } from "../mcp-app-frame";

function sandboxTokens(isolated?: boolean): string[] {
	const html = renderToStaticMarkup(
		createElement(McpAppFrame, {
			resourceUri: "ui://widget/card.html",
			toolInput: {},
			toolResult: {},
			resourceEndpoint: "https://host.example/resource",
			isolated,
		}),
	);
	const match = html.match(/sandbox="([^"]*)"/);
	if (!match?.[1]) {
		throw new Error(`no sandbox attribute in ${html}`);
	}
	return match[1].split(/\s+/).sort();
}

describe("McpAppFrame sandbox", () => {
	test("a default frame keeps the same-origin and popup-escape tokens", () => {
		expect(sandboxTokens()).toEqual([
			"allow-forms",
			"allow-popups",
			"allow-popups-to-escape-sandbox",
			"allow-same-origin",
			"allow-scripts",
		]);
	});

	test("isolated={false} renders the same sandbox as the default", () => {
		expect(sandboxTokens(false)).toEqual(sandboxTokens());
	});

	test("an isolated frame drops allow-same-origin and allow-popups-to-escape-sandbox", () => {
		expect(sandboxTokens(true)).toEqual([
			"allow-forms",
			"allow-popups",
			"allow-scripts",
		]);
	});
});
