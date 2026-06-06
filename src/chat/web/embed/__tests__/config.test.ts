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

	test("title undefined by default — chat renders headerless", () => {
		const config = resolveConfig({ token: "tok" });

		expect(config.title).toBeUndefined();
	});

	test("programmatic title is applied", () => {
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

	test("appearance.variables merges correctly", () => {
		const config = resolveConfig({
			token: "tok",
			appearance: {
				variables: { primaryColor: "#ff0000", fontFamily: "monospace" },
			},
		});

		expect(config.appearance?.variables?.primaryColor).toBe("#ff0000");
		expect(config.appearance?.variables?.fontFamily).toBe("monospace");
	});

	test("appearance.theme preset is preserved", () => {
		const config = resolveConfig({
			token: "tok",
			appearance: { theme: "dark" },
		});
		expect(config.appearance?.theme).toBe("dark");
	});

	test("no appearance set when unused", () => {
		const config = resolveConfig({ token: "tok" });
		expect(config.appearance).toBeUndefined();
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

describe("resolveConfig — render mode", () => {
	test("mode defaults to undefined (inline at consumption)", () => {
		const config = resolveConfig({ token: "tok" });
		expect(config.mode).toBeUndefined();
	});

	test("programmatic floating mode is preserved", () => {
		const config = resolveConfig({ token: "tok", mode: "floating" });
		expect(config.mode).toBe("floating");
	});

	test("position and launcherText pass through", () => {
		const config = resolveConfig({
			token: "tok",
			mode: "floating",
			position: "bottom-left",
			launcherText: "Chat with us",
		});
		expect(config.position).toBe("bottom-left");
		expect(config.launcherText).toBe("Chat with us");
	});

	test("height passes through", () => {
		const config = resolveConfig({ token: "tok", height: "80vh" });
		expect(config.height).toBe("80vh");
	});
});

describe("parseConfigFromScript — render mode attrs", () => {
	async function parseWithAttrs(
		attrs: Record<string, string>,
	): Promise<Record<string, unknown>> {
		const { parseConfigFromScript } = await import(
			`../config?t=${Date.now()}-${Math.random()}`
		);
		const fakeScript = {
			getAttribute(name: string) {
				return name in attrs ? attrs[name] : null;
			},
		};
		const prevDocument = g.document;
		const prevHtmlScriptElement = g.HTMLScriptElement;
		g.HTMLScriptElement = class {};
		Object.setPrototypeOf(fakeScript, g.HTMLScriptElement.prototype);
		g.document = { currentScript: fakeScript, querySelectorAll: () => [] };
		try {
			return parseConfigFromScript();
		} finally {
			g.document = prevDocument;
			g.HTMLScriptElement = prevHtmlScriptElement;
		}
	}

	test("data-mode=floating parses", async () => {
		const cfg = await parseWithAttrs({
			"data-token": "tok",
			"data-mode": "floating",
		});
		expect(cfg.mode).toBe("floating");
	});

	test("invalid data-mode is ignored", async () => {
		const cfg = await parseWithAttrs({
			"data-token": "tok",
			"data-mode": "popover",
		});
		expect(cfg.mode).toBeUndefined();
	});

	test("data-position, data-height, data-launcher-text parse", async () => {
		const cfg = await parseWithAttrs({
			"data-token": "tok",
			"data-position": "bottom-left",
			"data-height": "500px",
			"data-launcher-text": "Need help?",
		});
		expect(cfg.position).toBe("bottom-left");
		expect(cfg.height).toBe("500px");
		expect(cfg.launcherText).toBe("Need help?");
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
