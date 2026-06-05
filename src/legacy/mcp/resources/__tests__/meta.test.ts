import { describe, expect, it } from "bun:test";
import { buildMcpAppsResourceMeta, buildOpenAIResourceMeta } from "../meta";

describe("buildMcpAppsResourceMeta", () => {
	// Regression: Claude's MCP Apps host validates `ui.domain` against the format
	// "{hash}.claudemcpcontent.com" and rejects self-hosted widget origins. We must
	// never emit `ui.domain` for the MCP Apps resource.
	it("never emits ui.domain (Claude rejects non-claudemcpcontent.com domains)", () => {
		const meta = buildMcpAppsResourceMeta({
			description: "A widget",
			prefersBorder: true,
			widgetCSP: {
				connect_domains: ["https://v1.isalud.mcp.waniwani.run"],
				resource_domains: ["https://v1.isalud.mcp.waniwani.run"],
			},
		});

		expect(meta.ui).toBeDefined();
		expect(meta.ui).not.toHaveProperty("domain");
	});

	it("still conveys the widget origin via CSP domains", () => {
		const meta = buildMcpAppsResourceMeta({
			widgetCSP: {
				connect_domains: ["https://example.com"],
				resource_domains: ["https://example.com"],
				frame_domains: ["https://frames.example.com"],
				redirect_domains: ["https://redirect.example.com"],
			},
		});

		expect(meta.ui?.csp).toEqual({
			connectDomains: ["https://example.com"],
			resourceDomains: ["https://example.com"],
			frameDomains: ["https://frames.example.com"],
			redirectDomains: ["https://redirect.example.com"],
		});
	});

	it("includes prefersBorder when set", () => {
		expect(buildMcpAppsResourceMeta({ prefersBorder: true }).ui).toEqual({
			prefersBorder: true,
		});
		expect(buildMcpAppsResourceMeta({ prefersBorder: false }).ui).toEqual({
			prefersBorder: false,
		});
	});
});

describe("buildOpenAIResourceMeta", () => {
	// OpenAI's Apps SDK accepts arbitrary widget domains via `openai/widgetDomain`,
	// so the OpenAI path is unaffected by the Claude restriction above.
	it("still emits openai/widgetDomain", () => {
		const meta = buildOpenAIResourceMeta({
			description: "A widget",
			prefersBorder: true,
			widgetDomain: "my-app.com",
		});

		expect(meta["openai/widgetDomain"]).toBe("my-app.com");
	});
});
