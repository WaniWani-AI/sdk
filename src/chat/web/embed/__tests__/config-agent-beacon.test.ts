import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { parseConfigFromScript, resolveConfig } from "../config";

const GLOBAL_KEYS = ["document", "HTMLScriptElement"] as const;
const originals = new Map(
	GLOBAL_KEYS.map((key) => [key, Reflect.get(globalThis, key)]),
);

const installScript = (attributes: Record<string, string>) => {
	const win = new Window({
		url: "https://shop.example/",
		settings: {
			disableIframePageLoading: true,
			disableJavaScriptFileLoading: true,
			disableCSSFileLoading: true,
		},
	});
	Object.assign(win, { SyntaxError });
	const script = win.document.createElement("script");
	script.setAttribute("src", "https://app.waniwani.ai/embed.js");
	script.setAttribute("data-token", "wwp_public");
	for (const [name, value] of Object.entries(attributes)) {
		script.setAttribute(name, value);
	}
	win.document.head.appendChild(script);
	for (const key of GLOBAL_KEYS) {
		Object.assign(globalThis, { [key]: Reflect.get(win, key) });
	}
};

beforeEach(() => {
	installScript({});
});

afterAll(() => {
	for (const [key, value] of originals) {
		Object.assign(globalThis, { [key]: value });
	}
});

describe("data-agent-beacon on the script tag", () => {
	test("absent leaves the beacon on by default", () => {
		const parsed = parseConfigFromScript();

		expect(parsed.token).toBe("wwp_public");
		expect(parsed.agentBeacon).not.toBe(false);
	});

	for (const value of ["off", "false"]) {
		test(`"${value}" turns the beacon off`, () => {
			installScript({ "data-agent-beacon": value });

			expect(parseConfigFromScript().agentBeacon).toBe(false);
		});
	}

	for (const value of ["OFF", "False", " off ", "0"]) {
		test(`"${value}", written the way the other boolean attributes accept it, turns the beacon off`, () => {
			installScript({ "data-agent-beacon": value });

			expect(parseConfigFromScript().agentBeacon).toBe(false);
		});
	}

	for (const value of ["on", "true"]) {
		test(`"${value}" keeps the beacon on`, () => {
			installScript({ "data-agent-beacon": value });

			expect(parseConfigFromScript().agentBeacon).toBe(true);
		});
	}

	test("an empty attribute keeps the beacon on", () => {
		installScript({ "data-agent-beacon": "" });

		expect(parseConfigFromScript().agentBeacon).not.toBe(false);
	});
});

describe("agentBeacon passed to init", () => {
	test("false survives config resolution", () => {
		expect(
			resolveConfig({ token: "wwp_public", agentBeacon: false }).agentBeacon,
		).toBe(false);
	});

	test("left out, the resolved config does not turn the beacon off", () => {
		expect(resolveConfig({ token: "wwp_public" }).agentBeacon).not.toBe(false);
	});
});
