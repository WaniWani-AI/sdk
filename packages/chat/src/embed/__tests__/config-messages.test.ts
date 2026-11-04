import { afterAll, afterEach, describe, expect, spyOn, test } from "bun:test";

// biome-ignore lint/suspicious/noExplicitAny: test setup
const g = globalThis as any;

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

const warn = spyOn(console, "warn").mockImplementation(() => {});

afterEach(() => {
	warn.mockClear();
});

afterAll(() => {
	warn.mockRestore();
});

describe("parseConfigFromScript: wording overrides", () => {
	test("parses data-messages JSON into config.messages", async () => {
		const messages = {
			fr: { workingIndicator: { default: "Un instant…" } },
			en: { menu: { restart: "Start over" } },
		};
		const cfg = await parseWithAttrs({
			"data-token": "tok",
			"data-messages": JSON.stringify(messages),
		});
		expect(cfg.messages).toEqual(messages);
	});

	test("ignores invalid data-messages JSON", async () => {
		const cfg = await parseWithAttrs({
			"data-token": "tok",
			"data-messages": "{fr: not json",
		});
		expect(cfg.messages).toBeUndefined();
		expect(cfg.token).toBe("tok");
		expect(warn).toHaveBeenCalledTimes(1);
		expect(warn).toHaveBeenCalledWith("[Waniwani] Invalid data-messages JSON");
	});

	test("ignores data-messages JSON that is not an object", async () => {
		const cfg = await parseWithAttrs({
			"data-token": "tok",
			"data-messages": '"hello"',
		});
		expect(cfg.messages).toBeUndefined();
		expect(warn).toHaveBeenCalledTimes(1);
	});

	test("parses data-messages-url", async () => {
		const cfg = await parseWithAttrs({
			"data-token": "tok",
			"data-messages-url": "https://shop.example/messages.json",
		});
		expect(cfg.messagesUrl).toBe("https://shop.example/messages.json");
	});

	test("no wording attribute leaves both keys unset", async () => {
		const cfg = await parseWithAttrs({ "data-token": "tok" });
		expect("messages" in cfg).toBe(false);
		expect("messagesUrl" in cfg).toBe(false);
		expect(warn).not.toHaveBeenCalled();
	});
});
