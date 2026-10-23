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
	test("absent leaves the beacon off", () => {
		const parsed = parseConfigFromScript();

		expect(parsed.token).toBe("wwp_public");
		expect(parsed.agentBeacon).not.toBe(true);
	});

	for (const value of ["on", "true", "1", "", "ON", "True", " on ", " 1 "]) {
		test(`"${value}" turns the beacon on`, () => {
			installScript({ "data-agent-beacon": value });

			expect(parseConfigFromScript().agentBeacon).toBe(true);
		});
	}

	for (const value of ["off", "false", "0", "maybe", "yes please", "OFF"]) {
		test(`"${value}" leaves the beacon off`, () => {
			installScript({ "data-agent-beacon": value });

			expect(parseConfigFromScript().agentBeacon).not.toBe(true);
		});
	}
});

describe("agentBeacon passed to init", () => {
	test("true survives config resolution", () => {
		expect(
			resolveConfig({ token: "wwp_public", agentBeacon: true }).agentBeacon,
		).toBe(true);
	});

	test("left out, the resolved config does not turn the beacon on", () => {
		expect(resolveConfig({ token: "wwp_public" }).agentBeacon).not.toBe(true);
	});

	test("the script tag's opt-in turns it on for an init with no option", () => {
		installScript({ "data-agent-beacon": "on" });

		expect(resolveConfig({ token: "wwp_public" }).agentBeacon).toBe(true);
	});

	test("an init that says false wins over the script tag's opt-in", () => {
		installScript({ "data-agent-beacon": "on" });

		expect(
			resolveConfig({ token: "wwp_public", agentBeacon: false }).agentBeacon,
		).toBe(false);
	});
});
