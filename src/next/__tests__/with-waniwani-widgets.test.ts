import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withWaniwaniWidgets } from "../index";

const roots: string[] = [];
const ORIGINAL_SKIP_BUILD = process.env.WANIWANI_WIDGETS_SKIP_BUILD;

afterEach(() => {
	for (const root of roots.splice(0)) {
		rmSync(root, { force: true, recursive: true });
	}
	if (ORIGINAL_SKIP_BUILD === undefined) {
		delete process.env.WANIWANI_WIDGETS_SKIP_BUILD;
	} else {
		process.env.WANIWANI_WIDGETS_SKIP_BUILD = ORIGINAL_SKIP_BUILD;
	}
});

function createProject(): string {
	const root = mkdtempSync(join(tmpdir(), "waniwani-widgets-"));
	roots.push(root);
	mkdirSync(join(root, "lib/app/flow"), { recursive: true });
	writeFileSync(
		join(root, "lib/app/flow/resources.ts"),
		`
import { createResource } from "@waniwani/sdk/mcp";

export const tariffComparisonResource = createResource({
  id: "tariff_comparison",
  title: "Tariff comparison",
  baseUrl: "https://example.com",
  htmlPath: "/tariff-comparison",
  widgetDomain: "https://example.com",
});
`,
	);
	return root;
}

describe("withWaniwaniWidgets", () => {
	test("adds a stable widget manifest and cache headers", async () => {
		process.env.WANIWANI_WIDGETS_SKIP_BUILD = "1";
		const root = createProject();
		const config = withWaniwaniWidgets(
			{
				async headers() {
					return [{ source: "/:path*", headers: [] }];
				},
			},
			{
				projectRoot: root,
				resources: "./lib/app/flow/resources.ts",
			},
		);

		const manifest = JSON.parse(
			(config as { env?: Record<string, string> }).env
				?.WANIWANI_WIDGETS_MANIFEST ?? "{}",
		);
		const headers = await config.headers?.();

		expect(manifest.byId.tariff_comparison).toBe(
			"/widgets/tariff-comparison.html",
		);
		expect(manifest.byHtmlPath["/tariff-comparison"]).toBe(
			"/widgets/tariff-comparison.html",
		);
		expect(headers?.some((route) => route.source === "/widgets/:path*")).toBe(
			true,
		);
	});
});
