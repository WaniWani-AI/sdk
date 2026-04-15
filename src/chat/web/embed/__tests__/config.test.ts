import { describe, expect, test } from "bun:test";

// ---------------------------------------------------------------------------
// resolveConfig calls parseConfigFromScript() which needs DOM. In Node/bun
// test env, document.currentScript is null and querySelectorAll returns [].
// We mock the module to test pure merge logic without DOM dependency.
// Script tag parsing is integration-tested via playwriter.
// ---------------------------------------------------------------------------

// Stub document minimally so parseConfigFromScript doesn't throw
// biome-ignore lint/suspicious/noExplicitAny: test setup
const g = globalThis as any;
g.HTMLScriptElement = class HTMLScriptElement {};
g.document = {
	currentScript: null,
	querySelectorAll: () => [],
};

import { resolveConfig } from "../config";

// ---------------------------------------------------------------------------
// resolveConfig — programmatic path
// ---------------------------------------------------------------------------

describe("resolveConfig — programmatic", () => {
	test("valid config with all required fields", () => {
		const config = resolveConfig({
			api: "https://example.com/api/chat",
			token: "eyJ...",
		});

		expect(config.api).toBe("https://example.com/api/chat");
		expect(config.token).toBe("eyJ...");
	});

	test("applies defaults for optional fields", () => {
		const config = resolveConfig({
			api: "https://example.com/api/chat",
			token: "tok",
		});

		expect(config.title).toBe("Assistant");
		expect(config.position).toBe("bottom-right");
		expect(config.width).toBe(400);
		expect(config.height).toBe(600);
	});

	test("programmatic overrides defaults", () => {
		const config = resolveConfig({
			api: "https://example.com/api/chat",
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
			api: "https://example.com/api/chat",
			token: "tok",
			welcomeMessage: "Hello!",
			placeholder: "Type here...",
			container: "#chat",
			css: "https://example.com/custom.css",
		});

		expect(config.welcomeMessage).toBe("Hello!");
		expect(config.placeholder).toBe("Type here...");
		expect(config.container).toBe("#chat");
		expect(config.css).toBe("https://example.com/custom.css");
	});

	test("preserves suggestions array", () => {
		const config = resolveConfig({
			api: "https://example.com/api/chat",
			token: "tok",
			suggestions: ["Help", "Pricing"],
		});

		expect(config.suggestions).toEqual(["Help", "Pricing"]);
	});

	test("theme merges correctly", () => {
		const config = resolveConfig({
			api: "https://example.com/api/chat",
			token: "tok",
			theme: { primaryColor: "#ff0000", fontFamily: "monospace" },
		});

		expect(config.theme?.primaryColor).toBe("#ff0000");
		expect(config.theme?.fontFamily).toBe("monospace");
		expect(config.theme?.backgroundColor).toBeUndefined();
	});

	test("empty theme object allowed", () => {
		const config = resolveConfig({
			api: "https://example.com/api/chat",
			token: "tok",
			theme: {},
		});

		expect(config.theme).toEqual({});
	});
});

// ---------------------------------------------------------------------------
// resolveConfig — validation errors
// ---------------------------------------------------------------------------

describe("resolveConfig — validation", () => {
	test("throws when api missing", () => {
		expect(() => resolveConfig({ token: "tok" })).toThrow(
			"Missing required config: `api`",
		);
	});

	test("throws when token missing", () => {
		expect(() =>
			resolveConfig({ api: "https://example.com/api/chat" }),
		).toThrow("Missing required config: `token`");
	});

	test("throws when both missing", () => {
		expect(() => resolveConfig({})).toThrow("Missing required config: `api`");
	});

	test("throws with no args", () => {
		expect(() => resolveConfig()).toThrow("Missing required config: `api`");
	});

	test("api empty string treated as missing", () => {
		expect(() => resolveConfig({ api: "", token: "tok" })).toThrow(
			"Missing required config: `api`",
		);
	});

	test("token empty string treated as missing", () => {
		expect(() =>
			resolveConfig({ api: "https://example.com/api/chat", token: "" }),
		).toThrow("Missing required config: `token`");
	});
});
