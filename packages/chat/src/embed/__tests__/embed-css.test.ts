import { afterAll, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";

const GLOBALS = ["document", "HTMLElement", "Element", "Node"] as const;
// biome-ignore lint/suspicious/noExplicitAny: test setup
const originals = GLOBALS.map((key) => (globalThis as any)[key]);
const win = new Window({ url: "https://shop.example.com/" });
for (const key of GLOBALS) {
	// biome-ignore lint/suspicious/noExplicitAny: test setup
	(globalThis as any)[key] = (win as any)[key];
}

afterAll(() => {
	GLOBALS.forEach((key, i) => {
		// biome-ignore lint/suspicious/noExplicitAny: test teardown
		(globalThis as any)[key] = originals[i];
	});
});

const {
	extractPropertyRules,
	HOST_TEXT_RESET,
	injectEmbedCss,
	TAILWIND_PROPERTIES_STYLE_ID,
} = await import("../embed-css");

// WAN-1441: a theme's `body { font-weight: 500 }` reached the chat through the
// shadow boundary, because inheritance crosses it even though selectors don't.
// happy-dom computes no styles across shadow roots, so these tests guard the
// wiring and the rule; the rendered result was checked in a real browser.
describe("injectEmbedCss", () => {
	test("appends the text reset even when the compiled stylesheet is not inlined", () => {
		// Source, not the built bundle: the stylesheet placeholder is still in
		// place, so only the reset is added — it must not depend on the build.
		const shadow = document.createElement("div").attachShadow({ mode: "open" });
		injectEmbedCss(shadow);
		const styles = shadow.querySelectorAll("style");
		expect(styles.length).toBe(1);
		expect(styles[0]?.textContent).toBe(HOST_TEXT_RESET);
	});
});

describe("registered Tailwind properties", () => {
	const COMPILED =
		'@layer theme{:root{--ww-x:1}}@property --tw-border-style{syntax:"*";inherits:false;initial-value:solid}.ww\\:border{border-style:var(--tw-border-style);border-width:1px}@property --tw-translate-x{syntax:"*";inherits:false;initial-value:0}';

	test("extracts every @property block and nothing else", () => {
		expect(extractPropertyRules(COMPILED)).toBe(
			'@property --tw-border-style{syntax:"*";inherits:false;initial-value:solid}@property --tw-translate-x{syntax:"*";inherits:false;initial-value:0}',
		);
	});

	test("registers them once in the document head, where shadow trees see them", () => {
		document.getElementById(TAILWIND_PROPERTIES_STYLE_ID)?.remove();
		const first = document.createElement("div").attachShadow({ mode: "open" });
		const second = document.createElement("div").attachShadow({ mode: "open" });
		injectEmbedCss(first, COMPILED);
		injectEmbedCss(second, COMPILED);

		const registered = document.head.querySelectorAll(
			`style#${TAILWIND_PROPERTIES_STYLE_ID}`,
		);
		expect(registered.length).toBe(1);
		expect(registered[0]?.textContent).toContain("@property --tw-border-style");
		expect(first.querySelectorAll("style")[1]?.textContent).toBe(COMPILED);
	});
});

describe("HOST_TEXT_RESET", () => {
	test("pins the weight a host theme was leaking, on the host", () => {
		expect(HOST_TEXT_RESET.startsWith(":host{")).toBe(true);
		expect(HOST_TEXT_RESET).toContain("font-weight:400");
	});

	test("aligns to the start, so right-to-left pages keep working", () => {
		expect(HOST_TEXT_RESET).toContain("text-align:start");
		expect(HOST_TEXT_RESET).not.toContain("direction:");
	});

	test("leaves alone what the stylesheet or the theme already set", () => {
		// Preflight and the --ww-* theme variables own these; smoothing and
		// wrapping are better left to the host theme.
		for (const property of [
			"font-family",
			"color",
			"font-size",
			"line-height",
			"-webkit-font-smoothing",
			"overflow-wrap",
		]) {
			expect(HOST_TEXT_RESET).not.toContain(`${property}:`);
		}
	});
});
