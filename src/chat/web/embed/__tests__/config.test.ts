import { describe, expect, test } from "bun:test";

// biome-ignore lint/suspicious/noExplicitAny: test setup
const g = globalThis as any;
g.HTMLScriptElement = class HTMLScriptElement {};
g.document = {
	currentScript: null,
	querySelector: () => null,
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

	test("launcherText passes through", () => {
		const config = resolveConfig({
			token: "tok",
			mode: "floating",
			launcherText: "Chat with us",
		});
		expect(config.launcherText).toBe("Chat with us");
	});

	test("height passes through", () => {
		const config = resolveConfig({ token: "tok", height: "80vh" });
		expect(config.height).toBe("80vh");
	});
});

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

describe("parseConfigFromScript — render mode attrs", () => {
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

	test("data-height, data-launcher-text, data-appear-delay parse", async () => {
		const cfg = await parseWithAttrs({
			"data-token": "tok",
			"data-height": "500px",
			"data-launcher-text": "Need help?",
			"data-appear-delay": "1500",
		});
		expect(cfg.height).toBe("500px");
		expect(cfg.launcherText).toBe("Need help?");
		expect(cfg.appearDelay).toBe(1500);
	});
});

describe("parseConfigFromScript — data-visitor-id", () => {
	test("parses a host-supplied visitor id", async () => {
		const cfg = await parseWithAttrs({
			"data-token": "tok",
			"data-visitor-id": "posthog-distinct-123",
		});
		expect(cfg.visitorId).toBe("posthog-distinct-123");
	});

	test("absent when the attribute is not set", async () => {
		const cfg = await parseWithAttrs({ "data-token": "tok" });
		expect(cfg.visitorId).toBeUndefined();
	});
});

describe("parseConfigFromScript — data-disable-page-view", () => {
	test("undefined when unspecified — page view fires by default", async () => {
		const cfg = await parseWithAttrs({ "data-token": "tok" });
		expect(cfg.disablePageView).toBeUndefined();
	});

	test("'true' opts out of the page view", async () => {
		const cfg = await parseWithAttrs({
			"data-token": "tok",
			"data-disable-page-view": "true",
		});
		expect(cfg.disablePageView).toBe(true);
	});

	test("bare attribute (empty value) opts out", async () => {
		const cfg = await parseWithAttrs({
			"data-token": "tok",
			"data-disable-page-view": "",
		});
		expect(cfg.disablePageView).toBe(true);
	});

	test("'false' keeps the page view", async () => {
		const cfg = await parseWithAttrs({
			"data-token": "tok",
			"data-disable-page-view": "false",
		});
		expect(cfg.disablePageView).toBe(false);
	});
});

describe("parseConfigFromScript — data-show-tool-calls", () => {
	test("undefined when unspecified — consumers default to full panels", async () => {
		const cfg = await parseWithAttrs({ "data-token": "tok" });
		expect(cfg.showToolCalls).toBeUndefined();
	});

	test("'true' parses as true", async () => {
		const cfg = await parseWithAttrs({
			"data-token": "tok",
			"data-show-tool-calls": "true",
		});
		expect(cfg.showToolCalls).toBe(true);
	});

	test("'false' parses as false", async () => {
		const cfg = await parseWithAttrs({
			"data-token": "tok",
			"data-show-tool-calls": "false",
		});
		expect(cfg.showToolCalls).toBe(false);
	});

	test("'titles-only' parses as titles-only", async () => {
		const cfg = await parseWithAttrs({
			"data-token": "tok",
			"data-show-tool-calls": "titles-only",
		});
		expect(cfg.showToolCalls).toBe("titles-only");
	});

	test("'titles-only' is case- and whitespace-insensitive", async () => {
		const cfg = await parseWithAttrs({
			"data-token": "tok",
			"data-show-tool-calls": " Titles-Only ",
		});
		expect(cfg.showToolCalls).toBe("titles-only");
	});

	test("unrecognized value is ignored", async () => {
		const cfg = await parseWithAttrs({
			"data-token": "tok",
			"data-show-tool-calls": "maybe",
		});
		expect(cfg.showToolCalls).toBeUndefined();
	});
});

describe("findScriptTag — loader scenario", () => {
	test("returns document.currentScript when present (sync execution)", async () => {
		const { findScriptTag } = await import(
			`../config?t=${Date.now()}-${Math.random()}`
		);
		const prev = g.document;
		const prevH = g.HTMLScriptElement;
		g.HTMLScriptElement = class {};
		const cur = {};
		Object.setPrototypeOf(cur, g.HTMLScriptElement.prototype);
		g.document = {
			currentScript: cur,
			querySelector: () => null,
			querySelectorAll: () => [],
		};
		try {
			expect(findScriptTag()).toBe(cur);
		} finally {
			g.document = prev;
			g.HTMLScriptElement = prevH;
		}
	});

	test("async: prefers the script carrying data-token (the injected bundle)", async () => {
		const { findScriptTag } = await import(
			`../config?t=${Date.now()}-${Math.random()}`
		);
		const prev = g.document;
		const prevH = g.HTMLScriptElement;
		g.HTMLScriptElement = class {};
		// The loader has stripped its own data-token; only the bundle carries it.
		const bundle = {
			src: "https://cdn.jsdelivr.net/npm/@waniwani/sdk@0.14.11/dist/chat/embed.js",
			getAttribute: (n: string) => (n === "data-token" ? "wwp_x" : null),
		};
		Object.setPrototypeOf(bundle, g.HTMLScriptElement.prototype);
		g.document = {
			currentScript: null,
			querySelector: (sel: string) =>
				sel === "script[src][data-token]" ? bundle : null,
			querySelectorAll: () => [],
		};
		try {
			expect(findScriptTag()).toBe(bundle);
		} finally {
			g.document = prev;
			g.HTMLScriptElement = prevH;
		}
	});

	test("async, no data-token anywhere: falls back to /embed/ src match", async () => {
		const { findScriptTag } = await import(
			`../config?t=${Date.now()}-${Math.random()}`
		);
		const prev = g.document;
		const prevH = g.HTMLScriptElement;
		g.HTMLScriptElement = class {};
		const other = {
			src: "https://example.com/analytics.js",
			getAttribute: () => null,
		};
		const embed = {
			src: "https://app.waniwani.ai/embed.js",
			getAttribute: () => null,
		};
		Object.setPrototypeOf(other, g.HTMLScriptElement.prototype);
		Object.setPrototypeOf(embed, g.HTMLScriptElement.prototype);
		g.document = {
			currentScript: null,
			querySelector: () => null,
			querySelectorAll: () => [other, embed],
		};
		try {
			expect(findScriptTag()).toBe(embed);
		} finally {
			g.document = prev;
			g.HTMLScriptElement = prevH;
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

describe("resolveConfig — assistantBubble", () => {
	test("carries appearance.assistantBubble through", () => {
		const config = resolveConfig({
			token: "tok",
			appearance: { theme: "light", assistantBubble: true },
		});
		expect(config.appearance?.assistantBubble).toBe(true);
	});
});

describe("parseConfigFromScript — data-assistant-bubble", () => {
	test("'true' opts in", async () => {
		const cfg = await parseWithAttrs({
			"data-token": "tok",
			"data-assistant-bubble": "true",
		});
		expect(cfg.appearance).toEqual({ assistantBubble: true });
	});

	test("'1' and bare attribute opt in like sibling boolean attrs", async () => {
		const one = await parseWithAttrs({
			"data-token": "tok",
			"data-assistant-bubble": "1",
		});
		expect(one.appearance).toEqual({ assistantBubble: true });

		const bare = await parseWithAttrs({
			"data-token": "tok",
			"data-assistant-bubble": "",
		});
		expect(bare.appearance).toEqual({ assistantBubble: true });
	});

	test("'false' parses to an explicit false", async () => {
		const cfg = await parseWithAttrs({
			"data-token": "tok",
			"data-assistant-bubble": "false",
		});
		expect(cfg.appearance).toEqual({ assistantBubble: false });
	});

	test("unspecified leaves appearance untouched", async () => {
		const cfg = await parseWithAttrs({ "data-token": "tok" });
		expect(cfg.appearance).toBeUndefined();
	});
});

describe("resolveConfig — assistantBubble precedence", () => {
	test("script-tag false overrides remote true", () => {
		const config = resolveConfig(
			{ token: "tok" },
			{ appearance: { assistantBubble: true } },
			{ appearance: { assistantBubble: false } },
		);
		expect(config.appearance?.assistantBubble).toBe(false);
	});
});
