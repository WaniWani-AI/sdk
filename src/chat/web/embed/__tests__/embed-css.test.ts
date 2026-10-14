import { describe, expect, test } from "bun:test";
import { Window } from "happy-dom";

const win = new Window({ url: "https://saudeprime.pt/" });
for (const key of ["document", "HTMLElement", "Element", "Node"] as const) {
	// biome-ignore lint/suspicious/noExplicitAny: test setup
	(globalThis as any)[key] = (win as any)[key];
}

const { HOST_TEXT_RESET, injectEmbedCss } = await import("../embed-css");

// WAN-1441: a theme's `body { font-weight: 500 }` reached the chat through the
// shadow boundary, because inheritance crosses it even though selectors don't.
describe("injectEmbedCss", () => {
	test("puts the text reset in the shadow root, first", () => {
		const host = document.createElement("div");
		const shadow = host.attachShadow({ mode: "open" });
		injectEmbedCss(shadow);
		const first = shadow.querySelector("style");
		expect(first?.textContent).toBe(HOST_TEXT_RESET);
	});

	test("adds the reset even when the stylesheet placeholder was not inlined", () => {
		// Source, not the built bundle: the placeholder is still in place, so the
		// compiled stylesheet is skipped — the reset must not depend on it.
		const host = document.createElement("div");
		const shadow = host.attachShadow({ mode: "open" });
		injectEmbedCss(shadow);
		expect(shadow.querySelectorAll("style").length).toBe(1);
	});
});

describe("HOST_TEXT_RESET", () => {
	test("pins the weight the Divi theme was leaking", () => {
		expect(HOST_TEXT_RESET).toContain(":host{");
		expect(HOST_TEXT_RESET).toContain("font-weight:400");
	});

	test("resets only properties whose initial value the widget is designed for", () => {
		// Size, line height, colour and font family keep inheriting: resetting
		// them would resize or recolour the widget on every site using it today.
		for (const property of [
			"font-size",
			"line-height",
			"color",
			"font-family",
		]) {
			expect(HOST_TEXT_RESET).not.toContain(`${property}:`);
		}
	});
});
