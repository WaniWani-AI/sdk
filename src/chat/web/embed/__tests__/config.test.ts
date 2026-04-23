import { describe, expect, test } from "bun:test";

// biome-ignore lint/suspicious/noExplicitAny: test setup
const g = globalThis as any;
g.HTMLScriptElement = class HTMLScriptElement {};
g.document = {
	currentScript: null,
	querySelectorAll: () => [],
};

import { resolveConfig } from "../config";

describe("resolveConfig — programmatic", () => {
	test("token-only config uses default api", () => {
		const config = resolveConfig({ token: "wwp_test" });

		expect(config.api).toBe("https://app.waniwani.ai/api/mcp/chat");
		expect(config.token).toBe("wwp_test");
	});

	test("custom api overrides default", () => {
		const config = resolveConfig({
			api: "https://custom.app/api/chat",
			token: "wwp_test",
		});

		expect(config.api).toBe("https://custom.app/api/chat");
	});

	test("applies defaults for optional fields", () => {
		const config = resolveConfig({ token: "tok" });

		expect(config.title).toBe("Assistant");
		expect(config.position).toBe("bottom-right");
		expect(config.width).toBe(400);
		expect(config.height).toBe(600);
	});

	test("programmatic overrides defaults", () => {
		const config = resolveConfig({
			token: "tok",
			title: "Support",
			position: "bottom-left",
			width: 500,
			height: 700,
		});

		expect(config.title).toBe("Support");
		expect(config.position).toBe("bottom-left");
		expect(config.width).toBe(500);
		expect(config.height).toBe(700);
	});

	test("preserves optional string fields", () => {
		const config = resolveConfig({
			token: "tok",
			welcomeMessage: "Hello!",
			placeholder: "Type here...",
			css: "https://example.com/custom.css",
		});

		expect(config.welcomeMessage).toBe("Hello!");
		expect(config.placeholder).toBe("Type here...");
		expect(config.css).toBe("https://example.com/custom.css");
	});

	test("theme merges correctly", () => {
		const config = resolveConfig({
			token: "tok",
			theme: { primaryColor: "#ff0000", fontFamily: "monospace" },
		});

		expect(config.theme?.primaryColor).toBe("#ff0000");
		expect(config.theme?.fontFamily).toBe("monospace");
	});

	test("empty theme object allowed", () => {
		const config = resolveConfig({ token: "tok", theme: {} });
		expect(config.theme).toEqual({});
	});
});

describe("resolveConfig — validation", () => {
	test("throws when token missing", () => {
		expect(() => resolveConfig({})).toThrow("Missing required config: `token`");
	});

	test("throws with no args", () => {
		expect(() => resolveConfig()).toThrow("Missing required config: `token`");
	});

	test("token empty string treated as missing", () => {
		expect(() => resolveConfig({ token: "" })).toThrow(
			"Missing required config: `token`",
		);
	});
});
