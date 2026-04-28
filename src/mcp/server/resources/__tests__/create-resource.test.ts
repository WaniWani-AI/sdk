import { afterEach, describe, expect, test } from "bun:test";
import { createResource } from "../create-resource";
import { WANIWANI_WIDGETS_MANIFEST_ENV } from "../widget-manifest";

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_MANIFEST = process.env[WANIWANI_WIDGETS_MANIFEST_ENV];

afterEach(() => {
	globalThis.fetch = ORIGINAL_FETCH;
	if (ORIGINAL_MANIFEST === undefined) {
		delete process.env[WANIWANI_WIDGETS_MANIFEST_ENV];
	} else {
		process.env[WANIWANI_WIDGETS_MANIFEST_ENV] = ORIGINAL_MANIFEST;
	}
});

describe("createResource", () => {
	test("fetches generated stable widget HTML when a widget manifest maps the route", async () => {
		const requests: string[] = [];
		process.env[WANIWANI_WIDGETS_MANIFEST_ENV] = JSON.stringify({
			version: 1,
			byId: {
				tariff_comparison: "/widgets/tariff-comparison.html",
			},
			byHtmlPath: {
				"/tariff-comparison": "/widgets/tariff-comparison.html",
			},
		});
		globalThis.fetch = (async (input: RequestInfo | URL) => {
			requests.push(String(input));
			return new Response(
				'<script src="__WANIWANI_WIDGET_BASE_URL__/widgets/tariff-comparison.js"></script>',
			);
		}) as typeof fetch;

		const resource = createResource({
			id: "tariff_comparison",
			title: "Tariff comparison",
			baseUrl: "https://example.com",
			htmlPath: "/tariff-comparison",
			widgetDomain: "https://example.com",
		});
		let handler:
			| ((uri: URL) => Promise<{ contents: Array<{ text: string }> }>)
			| undefined;

		await resource.register({
			registerResource: (_name, _uri, _meta, callback) => {
				handler = callback as unknown as typeof handler;
			},
		} as Parameters<typeof resource.register>[0]);

		const response = await handler?.(new URL(resource.openaiUri));

		expect(requests[0]).toBe(
			"https://example.com/widgets/tariff-comparison.html",
		);
		expect(response?.contents[0].text).toContain(
			"https://example.com/widgets/tariff-comparison.js",
		);
	});
});
