import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";

const win = new Window({ url: "https://shop.example.com" });
for (const key of [
	"document",
	"navigator",
	"HTMLElement",
	"HTMLDivElement",
	"MutationObserver",
	"customElements",
	"Element",
	"Node",
	"Text",
	"Comment",
	"DocumentFragment",
	"Event",
	"CustomEvent",
	"requestAnimationFrame",
	"cancelAnimationFrame",
	"getComputedStyle",
] as const) {
	// biome-ignore lint/suspicious/noExplicitAny: test setup
	(globalThis as any)[key] = (win as any)[key];
}
// biome-ignore lint/suspicious/noExplicitAny: test setup
(globalThis as any).window = win;
// biome-ignore lint/suspicious/noExplicitAny: test setup
(win as any).SyntaxError = SyntaxError;
// biome-ignore lint/suspicious/noExplicitAny: test setup
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const { act, createElement } = await import("react");
const { createRoot } = await import("react-dom/client");
type Root = ReturnType<typeof createRoot>;

const { Suggestions } = await import("./suggestions");

let root: Root;
let container: HTMLElement;

beforeEach(() => {
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(() => {
	act(() => {
		root.unmount();
	});
	container.remove();
});

const pills = Array.from({ length: 12 }, (_, i) => `Suggestion number ${i}`);

function render(props: Record<string, unknown>) {
	act(() => {
		root.render(
			createElement(Suggestions, {
				suggestions: pills,
				onSelect: () => {},
				...props,
			}),
		);
	});
}

describe("Suggestions", () => {
	test("renders one sideways-scrolling row of one-line pills", () => {
		render({});
		const row = container.querySelector(".ww-suggestions-row");
		expect(row?.className).toContain("ww:overflow-x-auto");
		expect(row?.className).not.toContain("flex-wrap");
		const pill = container.querySelector(".ww-suggestion");
		expect(pill?.className).toContain("ww:whitespace-nowrap");
		expect(pill?.className).toContain("ww:max-w-full");
		expect(pill?.getAttribute("title")).toBe(pills[0]);
	});

	test("the scrollbar rule outranks the chat's global thin scrollbar", () => {
		const css = readFileSync(
			new URL("../tailwind.css", import.meta.url),
			"utf8",
		);
		expect(css).toContain(
			".ww-suggestions-row,\n[data-waniwani-chat] .ww-suggestions-row {\n\tscrollbar-width: none;\n}",
		);
		expect(css).not.toContain('data-layout="single-row"');
	});

	test("a deprecated layout still reaches data-layout and changes nothing", () => {
		render({ layout: "single-row" });
		expect(
			container.querySelector(".ww-suggestions")?.getAttribute("data-layout"),
		).toBe("single-row");
		expect(container.querySelector(".ww-suggestions-row")?.className).toContain(
			"ww:overflow-x-auto",
		);
	});

	test("centered pills center while they fit, without breaking the scroll", () => {
		render({ align: "center" });
		const pill = container.querySelector(".ww-suggestion");
		expect(pill?.className).toContain("ww:first:ms-auto");
		expect(pill?.className).toContain("ww:last:me-auto");
		expect(
			container.querySelector(".ww-suggestions-row")?.className,
		).not.toContain("justify-center");
	});

	test("renders data-index per pill", () => {
		render({});
		const indexes = Array.from(
			container.querySelectorAll(".ww-suggestion"),
		).map((el) => el.getAttribute("data-index"));
		expect(indexes).toEqual(pills.map((_, i) => String(i)));
	});

	test("staggers through --ww-index, not an inline animation-delay", () => {
		render({});
		const third = container.querySelectorAll(
			".ww-suggestion",
		)[2] as HTMLElement;
		expect(third.getAttribute("style")).toBe("--ww-index: 2;");
		expect(third.style.animationDelay).toBe("");
		expect(third.className).not.toContain("ww-fade-in");
	});

	test("the row carries the same data-origin as its pills", () => {
		render({ origin: "dock" });
		expect(
			container.querySelector(".ww-suggestions")?.getAttribute("data-origin"),
		).toBe("dock");
		expect(
			container.querySelector(".ww-suggestion")?.getAttribute("data-origin"),
		).toBe("dock");
	});
});

describe("WelcomeScreen cards", () => {
	test("stagger through --ww-index, not an inline animation-delay", async () => {
		const { WelcomeScreen } = await import("./welcome-screen");
		act(() => {
			root.render(
				createElement(WelcomeScreen, {
					title: "Hi",
					suggestions: ["One", "Two", "Three"],
				}),
			);
		});
		const third = container.querySelectorAll(
			".ww-suggestion",
		)[2] as HTMLElement;
		expect(third.getAttribute("style")).toBe("--ww-index: 2;");
		expect(third.className).not.toContain("ww-fade-in");
	});
});

describe("WelcomeScreen icon", () => {
	async function renderIcon(icon: string) {
		const { WelcomeScreen } = await import("./welcome-screen");
		act(() => {
			root.render(createElement(WelcomeScreen, { title: "Hi", icon }));
		});
	}

	test("an image URL renders as the welcome avatar", async () => {
		await renderIcon("https://cdn.example.com/bot.svg");
		const img = container.querySelector("img.ww-avatar");
		expect(img?.getAttribute("src")).toBe("https://cdn.example.com/bot.svg");
		expect(img?.getAttribute("data-slot")).toBe("welcome");
	});

	test("a relative path renders as the welcome avatar", async () => {
		await renderIcon("./assets/bot.png");
		expect(container.querySelector("img.ww-avatar")?.getAttribute("src")).toBe(
			"./assets/bot.png",
		);
	});

	test("a text icon stays text", async () => {
		await renderIcon("👋");
		expect(container.querySelector("img")).toBeNull();
		expect(container.querySelector(".ww-welcome")?.textContent).toContain("👋");
	});

	test("an empty string renders no icon at all", async () => {
		await renderIcon("");
		expect(container.querySelector("img")).toBeNull();
		const welcome = container.querySelector(".ww-welcome");
		expect(welcome?.firstElementChild?.tagName).toBe("H2");
	});
});
