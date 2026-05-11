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
	});

	test("programmatic overrides defaults", () => {
		const config = resolveConfig({
			token: "tok",
			title: "Support",
		});

		expect(config.title).toBe("Support");
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

describe("resolveConfig — enableThreadHistory", () => {
	test("programmatic false disables thread history", () => {
		const config = resolveConfig({ token: "tok", enableThreadHistory: false });
		expect(config.enableThreadHistory).toBe(false);
	});

	test("programmatic true enables thread history", () => {
		const config = resolveConfig({ token: "tok", enableThreadHistory: true });
		expect(config.enableThreadHistory).toBe(true);
	});

	test("undefined when unspecified — consumers default to enabled", () => {
		const config = resolveConfig({ token: "tok" });
		expect(config.enableThreadHistory).toBeUndefined();
	});

	test("data-enable-thread-history attribute parses 'false' as false", async () => {
		const { parseConfigFromScript } = await import(
			`../config?t=${Date.now()}-${Math.random()}`
		);
		const fakeScript = {
			getAttribute(name: string) {
				if (name === "data-token") {
					return "tok";
				}
				if (name === "data-enable-thread-history") {
					return "false";
				}
				return null;
			},
		};
		const prevDocument = g.document;
		const prevHtmlScriptElement = g.HTMLScriptElement;
		g.HTMLScriptElement = class {};
		Object.setPrototypeOf(fakeScript, g.HTMLScriptElement.prototype);
		g.document = {
			currentScript: fakeScript,
			querySelectorAll: () => [],
		};
		try {
			const cfg = parseConfigFromScript();
			expect(cfg.enableThreadHistory).toBe(false);
		} finally {
			g.document = prevDocument;
			g.HTMLScriptElement = prevHtmlScriptElement;
		}
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
