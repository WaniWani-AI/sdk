import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const webDir = join(import.meta.dir, "..");
function source(path: string): string {
	return readFileSync(join(webDir, path), "utf8");
}

const css = readFileSync(join(import.meta.dir, "../tailwind.css"), "utf8");

function blockStartingWith(selector: string): string {
	const start = css.indexOf(`${selector} {`);
	expect(start).toBeGreaterThan(-1);
	let depth = 0;
	for (let i = css.indexOf("{", start); i < css.length; i++) {
		if (css[i] === "{") {
			depth++;
		} else if (css[i] === "}") {
			depth--;
			if (depth === 0) {
				return css.slice(start, i + 1);
			}
		}
	}
	throw new Error(`Unclosed block for ${selector}`);
}

const DEFAULTS: Record<string, string> = {
	"--ww-content-max-width": "48rem",
	"--ww-send-bg": "var(--ww-color-foreground)",
	"--ww-send-fg": "var(--ww-color-background)",
	"--ww-send-size": "1.75rem",
	"--ww-send-radius": "9999px",
	"--ww-send-disabled-bg": "var(--ww-send-bg)",
	"--ww-send-disabled-fg": "var(--ww-send-fg)",
	"--ww-send-disabled-opacity": "1",
	"--ww-stop-bg": "var(--ww-send-bg)",
	"--ww-stop-fg": "var(--ww-send-fg)",
	"--ww-suggestion-bg": "var(--ww-color-accent)",
	"--ww-suggestion-fg": "var(--ww-color-foreground)",
	"--ww-suggestion-border": "var(--ww-color-border)",
	"--ww-suggestion-radius": "9999px",
	"--ww-suggestion-hover-bg": "var(--ww-color-border)",
	"--ww-suggestion-stagger": "50ms",
	"--ww-input-radius": "1rem",
	"--ww-input-border": "var(--ww-color-border)",
	"--ww-input-border-width": "1px",
	"--ww-input-shadow": "none",
	"--ww-header-height": "auto",
	"--ww-avatar-size": "2rem",
	"--ww-panel-width": "1000px",
	"--ww-panel-height": "720px",
	"--ww-panel-radius": "1rem",
	"--ww-panel-offset": "1rem",
	"--ww-panel-open-duration": "440ms",
	"--ww-panel-close-duration": "260ms",
	"--ww-dock-width": "440px",
	"--ww-dock-width-expanded": "720px",
	"--ww-dock-radius": "20px",
	"--ww-dock-bg": "var(--ww-glass)",
	"--ww-dock-border": "var(--ww-glass-border)",
	"--ww-dock-field-radius": "16px",
	"--ww-dock-field-border": "var(--ww-color-border)",
	"--ww-dock-field-border-width": "1px",
	"--ww-heading-1": "1.875rem",
	"--ww-heading-2": "1.5rem",
	"--ww-heading-3": "1.25rem",
	"--ww-disclaimer-fg": "var(--ww-color-muted-foreground)",
	"--ww-disclaimer-size": "0.6875rem",
	"--ww-z-index": "calc(var(--ww-z-index-hi, 2147) * 1000000 + 483002)",
	"--ww-toast-duration": "2200ms",
	"--ww-toast-leave-duration": "200ms",
};

describe("embed tokens", () => {
	const root = blockStartingWith("[data-waniwani-chat]");

	for (const [token, value] of Object.entries(DEFAULTS)) {
		test(`${token} defaults to ${value}`, () => {
			expect(root).toContain(`\t${token}: ${value};`);
		});
	}

	test("the --ww-radius custom-property cycle and its alias are gone", () => {
		expect(css).not.toContain("--ww-radius: var(--ww-radius");
		expect(css).not.toContain("--ww-radius-resolved");
	});

	test("the chat root applies --ww-radius, defaulting to no radius", () => {
		expect(css).toContain(
			":where([data-waniwani-chat]) {\n\tborder-radius: var(--ww-radius, 0);\n}",
		);
	});

	test("--color-destructive is declared in @theme", () => {
		expect(blockStartingWith("@theme reference")).toContain(
			"--color-destructive:",
		);
	});

	test("--ww-color-destructive is declared in light, dark and auto blocks", () => {
		const light = root;
		const dark = blockStartingWith("[data-waniwani-chat].dark");
		const auto = blockStartingWith(
			'[data-waniwani-chat][data-color-scheme="auto"]',
		);
		expect(light).toContain(
			"--ww-color-destructive: var(--ww-destructive, #dc2626);",
		);
		expect(dark).toContain(
			"--ww-color-destructive: var(--ww-destructive, #f87171);",
		);
		expect(auto).toContain(
			"--ww-color-destructive: var(--ww-destructive, #f87171);",
		);
	});

	test("the panel closes over the close token and opens over the open token", () => {
		const motion = blockStartingWith(
			"@media (prefers-reduced-motion: no-preference)",
		);
		const opening =
			'[data-waniwani-floating="panel"][data-state="opening"],\n\t[data-waniwani-floating="panel"][data-state="shown"] {';
		expect(motion).toContain(opening);
		const [closing, open] = motion.split(opening);
		expect(closing).toContain(
			'[data-waniwani-floating="panel"] {\n\t\ttransition: clip-path var(--ww-panel-close-duration) cubic-bezier(0.22, 1, 0.36, 1),',
		);
		expect(closing).toContain(
			"visibility 0s linear var(--ww-panel-close-duration);",
		);
		expect(closing).not.toContain("--ww-panel-open-duration");
		expect(open).toContain(
			"clip-path var(--ww-panel-open-duration) cubic-bezier(0.22, 1, 0.36, 1)",
		);
		expect(open).toContain("visibility 0s;");
	});

	test("send button, content column and panel consume their tokens", () => {
		expect(css).toContain(".ww-send");
		expect(css).toContain("background-color: var(--ww-send-bg)");
		expect(source("layouts/chat-embed.tsx")).toContain(
			"var(--ww-content-max-width)",
		);
		expect(source("embed/floating-chat.tsx")).toContain(
			"var(--ww-panel-width)",
		);
		expect(source("embed/composer-chat.tsx")).toContain(
			"var(--ww-panel-width)",
		);
		expect(source("ui/button.tsx")).toContain("var(--ww-send-size)");
	});

	test("the pill fade-in only runs without a reduced-motion preference", () => {
		const gated =
			"@media (prefers-reduced-motion: no-preference) {\n\t:where(.ww-suggestion) {\n\t\tanimation: ww-fade-in 0.2s ease-out both;\n\t}\n}";
		expect(css).toContain(gated);
		expect(css.split("animation: ww-fade-in").length).toBe(2);
	});

	test("the pill stagger reads --ww-index after the animation shorthand", () => {
		const stagger = css.indexOf(
			"animation-delay: calc(var(--ww-suggestion-stagger) * var(--ww-index, 0));",
		);
		expect(stagger).toBeGreaterThan(
			css.indexOf("animation: ww-fade-in 0.2s ease-out both;"),
		);
	});

	test("--ww-disclaimer-size drops to 10px below 640px and applies at every width", () => {
		expect(css).toContain(
			"@media (width < 40rem) {\n\t[data-waniwani-chat] {\n\t\t--ww-disclaimer-size: 0.625rem;\n\t}\n}",
		);
		for (const file of [
			"components/ai-disclaimer.tsx",
			"components/powered-by.tsx",
		]) {
			expect(source(file)).not.toContain("text-[10px]");
			expect(source(file)).toContain(
				"ww:text-[length:var(--ww-disclaimer-size)]",
			);
		}
	});

	test("send and stop never shrink", () => {
		expect(
			blockStartingWith(
				":where([data-waniwani-chat]) .ww-send,\n\t:where([data-waniwani-chat]) .ww-send:hover",
			),
		).toContain("flex-shrink: 0;");
		expect(
			blockStartingWith(
				":where([data-waniwani-chat]) .ww-stop,\n\t:where([data-waniwani-chat]) .ww-stop:hover",
			),
		).toContain("flex-shrink: 0;");
	});

	test("the input, send and stop token rules sit in @layer components so classNames utilities win", () => {
		const layer = blockStartingWith("@layer components");
		for (const rule of [
			":where([data-waniwani-chat]) .ww-input {\n\t\tborder-radius: var(--ww-input-radius);",
			":where([data-waniwani-chat]) .ww-send,",
			":where([data-waniwani-chat]) .ww-send:disabled {",
			":where([data-waniwani-chat]) .ww-stop,",
		]) {
			expect(layer).toContain(rule);
			expect(css.split(rule).length).toBe(2);
		}
	});

	test("the composer and send button carry no default utility the token rules own", () => {
		const embed = source("layouts/chat-embed.tsx");
		expect(embed).not.toContain("ww:rounded-2xl ww:border-border");
		const promptInput = source("ai-elements/prompt-input.tsx");
		expect(promptInput).not.toContain(
			"ww:rounded-lg ww:border ww:border-border",
		);
		expect(promptInput).toContain('variant="themed"');
	});
});
