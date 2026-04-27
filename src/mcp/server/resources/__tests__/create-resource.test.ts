import { afterEach, describe, expect, test } from "bun:test";
import { createResource } from "../create-resource";

const ORIGINAL_VERCEL_DEPLOYMENT_ID = process.env.VERCEL_DEPLOYMENT_ID;

afterEach(() => {
	if (ORIGINAL_VERCEL_DEPLOYMENT_ID === undefined) {
		delete process.env.VERCEL_DEPLOYMENT_ID;
	} else {
		process.env.VERCEL_DEPLOYMENT_ID = ORIGINAL_VERCEL_DEPLOYMENT_ID;
	}
});

function resourceConfig(
	overrides: Partial<Parameters<typeof createResource>[0]> = {},
) {
	return {
		id: "insurance_comparison",
		title: "Insurance comparison",
		baseUrl: "https://example.com",
		htmlPath: "/widgets/comparison.html",
		widgetDomain: "https://example.com",
		...overrides,
	};
}

describe("createResource", () => {
	test("appends explicit cache key as dpl query parameter to template URIs", () => {
		process.env.VERCEL_DEPLOYMENT_ID = "ignored";

		const resource = createResource(resourceConfig({ cacheKey: "dpl_abc123" }));

		expect(resource.openaiUri).toBe(
			"ui://widgets/apps-sdk/insurance_comparison.html?dpl=dpl_abc123",
		);
		expect(resource.mcpUri).toBe(
			"ui://widgets/ext-apps/insurance_comparison.html?dpl=dpl_abc123",
		);
	});

	test("defaults cache key to VERCEL_DEPLOYMENT_ID", () => {
		process.env.VERCEL_DEPLOYMENT_ID = "dpl_from_env";

		const resource = createResource(resourceConfig());

		expect(resource.openaiUri).toBe(
			"ui://widgets/apps-sdk/insurance_comparison.html?dpl=dpl_from_env",
		);
		expect(resource.mcpUri).toBe(
			"ui://widgets/ext-apps/insurance_comparison.html?dpl=dpl_from_env",
		);
	});

	test("encodes cache key values", () => {
		const resource = createResource(resourceConfig({ cacheKey: "build 1/2" }));

		expect(resource.openaiUri).toBe(
			"ui://widgets/apps-sdk/insurance_comparison.html?dpl=build%201%2F2",
		);
	});

	test("omits dpl query parameter when cache key is empty", () => {
		process.env.VERCEL_DEPLOYMENT_ID = "dpl_from_env";

		const resource = createResource(resourceConfig({ cacheKey: "" }));

		expect(resource.openaiUri).toBe(
			"ui://widgets/apps-sdk/insurance_comparison.html",
		);
		expect(resource.mcpUri).toBe(
			"ui://widgets/ext-apps/insurance_comparison.html",
		);
	});
});
