import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";

const win = new Window({ url: "https://shop.example.com/pricing" });
for (const key of [
	"document",
	"navigator",
	"localStorage",
	"sessionStorage",
	"screen",
	"location",
	"HTMLElement",
	"HTMLDivElement",
	"HTMLFormElement",
	"HTMLInputElement",
	"HTMLTextAreaElement",
	"Element",
	"Node",
	"Text",
	"Comment",
	"DocumentFragment",
	"Event",
	"CustomEvent",
	"KeyboardEvent",
	"MouseEvent",
	"PointerEvent",
	"MutationObserver",
	"IntersectionObserver",
	"ResizeObserver",
	"customElements",
	"matchMedia",
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

let scrollSpyRestore: (() => void) | null = null;

const { act, createElement, createRef, useLayoutEffect, useRef } = await import(
	"react"
);
const { createRoot } = await import("react-dom/client");
const { FloatingChat } = await import("../floating-chat");
const { ComposerChat } = await import("../composer-chat");
const { ChatEmbed } = await import("../../layouts/chat-embed");
const { usePanelState } = await import("../use-panel-state");
type PanelState = import("../use-panel-state").PanelState;
type EmbedConfig = import("../config").EmbedConfig;
type FloatingChatHandle = import("../floating-chat").FloatingChatHandle;

const CONFIG: EmbedConfig = {
	token: "wwp_test",
	api: "https://brand.mock/api/chat",
	mode: "floating",
	appearDelay: 0,
};

const realFetch = globalThis.fetch;
const realRequestAnimationFrame = globalThis.requestAnimationFrame;
let container: HTMLElement;
let root: ReturnType<typeof createRoot>;
let portalTargets: HTMLElement[] = [];
const desktopWidth = win.innerWidth;

beforeEach(() => {
	// BorderGlow's one-off sweep drives React state from an uncancellable rAF
	// loop for 2 s; the tests do not exercise it.
	globalThis.requestAnimationFrame = (() => 0) as typeof requestAnimationFrame;
	globalThis.fetch = (async () =>
		new Response("{}", {
			status: 200,
			headers: { "Content-Type": "application/json" },
		})) as unknown as typeof fetch;
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(() => {
	act(() => root.unmount());
	scrollSpyRestore?.();
	scrollSpyRestore = null;
	container.remove();
	for (const target of portalTargets) {
		target.remove();
	}
	portalTargets = [];
	globalThis.fetch = realFetch;
	globalThis.requestAnimationFrame = realRequestAnimationFrame;
	setViewportWidth(desktopWidth);
});

function setViewportWidth(width: number) {
	// biome-ignore lint/suspicious/noExplicitAny: happy-dom viewport
	(win as any).innerWidth = width;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function renderSettled(element: ReturnType<typeof createElement>) {
	await act(async () => {
		root.render(element);
	});
	await act(async () => {
		await wait(20);
	});
}

function setInputValue(
	input: HTMLInputElement | HTMLTextAreaElement,
	value: string,
) {
	const setter = Object.getOwnPropertyDescriptor(
		Object.getPrototypeOf(input),
		"value",
	)?.set;
	setter?.call(input, value);
	input.dispatchEvent(new win.Event("input", { bubbles: true }) as never);
}

describe("floating dock and panel hooks", () => {
	test("renders the dock, its parts and a hidden panel", async () => {
		await renderSettled(createElement(FloatingChat, { config: CONFIG }));

		expect(
			container.querySelector(".ww-dock")?.getAttribute("data-has-text"),
		).toBe("false");
		expect(container.querySelector(".ww-dock .ww-dock-input")).not.toBeNull();
		expect(
			container.querySelector(".ww-panel")?.getAttribute("data-state"),
		).toBe("hidden");

		const dock = container.querySelector(".ww-dock");
		expect(dock?.getAttribute("data-state")).toBe("shown");
		expect(dock?.getAttribute("data-appeared")).toBe("true");
		expect(dock?.getAttribute("data-expanded")).toBe("false");
		expect(dock?.getAttribute("data-hover")).toBe("false");
		expect(dock?.hasAttribute("data-multiline")).toBe(false);
		expect(
			container.querySelector(".ww-panel .ww-root")?.getAttribute("data-mode"),
		).toBe("floating");
		expect(
			container
				.querySelector(".ww-dock .ww-dock-input")
				?.hasAttribute("data-multiline"),
		).toBe(false);
		expect(container.querySelector(".ww-dock .ww-dock-send")).not.toBeNull();
		expect(container.querySelector(".ww-panel .ww-close")).not.toBeNull();
		expect(container.querySelector(".ww-avatar")).toBeNull();
		expect(container.querySelector(".ww-welcome")).toBeNull();
	});

	test("shows the avatar in the dock and the structured welcome in the panel", async () => {
		await renderSettled(
			createElement(FloatingChat, {
				config: {
					...CONFIG,
					suggestions: ["Pricing", "Support"],
					avatar: "https://x/a.svg",
					avatarSlots: ["welcome", "dock"],
					welcomeTitle: "Bonjour,|parlez-nous de votre projet",
					welcomeSubtitle: ["One", "Two"],
					welcomeMessage: "Hi there",
				},
			}),
		);

		expect(
			container.querySelector(".ww-dock .ww-avatar[data-slot=dock]"),
		).not.toBeNull();
		const panel = container.querySelector(".ww-panel");
		expect(
			panel?.querySelector(".ww-welcome .ww-avatar[data-slot=welcome]"),
		).not.toBeNull();
		expect(panel?.querySelector(".ww-header .ww-avatar")).toBeNull();
		expect(
			panel?.querySelectorAll(".ww-welcome-suggestions .ww-suggestion").length,
		).toBe(2);
		expect(panel?.querySelectorAll(".ww-suggestion").length).toBe(2);
		expect(panel?.textContent).not.toContain("Hi there");
	});

	test("reflects typed text and pointer hover on the dock", async () => {
		await renderSettled(createElement(FloatingChat, { config: CONFIG }));
		const dock = container.querySelector(".ww-dock") as HTMLElement;
		const input = container.querySelector(".ww-dock-input") as HTMLInputElement;

		await act(async () => {
			setInputValue(input, "hello");
		});
		expect(dock.getAttribute("data-has-text")).toBe("true");

		await act(async () => {
			setInputValue(input, "   ");
		});
		expect(dock.getAttribute("data-has-text")).toBe("false");

		await act(async () => {
			dock.dispatchEvent(
				new win.PointerEvent("pointerover", { bubbles: true }) as never,
			);
		});
		expect(dock.getAttribute("data-hover")).toBe("true");

		await act(async () => {
			dock.dispatchEvent(
				new win.PointerEvent("pointerout", { bubbles: true }) as never,
			);
		});
		expect(dock.getAttribute("data-hover")).toBe("false");
	});

	test("wraps dock suggestions and shows the dock close once expanded", async () => {
		await renderSettled(
			createElement(FloatingChat, {
				config: { ...CONFIG, suggestions: ["Pricing", "Support"] },
			}),
		);
		const input = container.querySelector(".ww-dock-input") as HTMLInputElement;
		await act(async () => {
			input.dispatchEvent(
				new win.FocusEvent("focusin", { bubbles: true }) as never,
			);
			await wait(120);
		});

		const dock = container.querySelector(".ww-dock");
		expect(dock?.getAttribute("data-expanded")).toBe("true");
		expect(container.querySelector(".ww-dock .ww-dock-close")).not.toBeNull();
		expect(
			container.querySelectorAll(".ww-dock-suggestions .ww-suggestion").length,
		).toBe(2);
	});
});

describe("dock field and card hooks", () => {
	test("the field wrapper carries the hook and reads the radius token", async () => {
		await renderSettled(createElement(FloatingChat, { config: CONFIG }));
		const field = container.querySelector(
			".ww-dock .ww-dock-field",
		) as HTMLElement;
		expect(field).not.toBeNull();
		expect(field.querySelector(".ww-dock-input")).not.toBeNull();
		expect(field.style.borderRadius).toBe("var(--ww-dock-field-radius)");
		expect(field.className).not.toContain("ww:border-border");
	});

	test("the frosted card carries the hook and its expanded state", async () => {
		await renderSettled(
			createElement(FloatingChat, {
				config: { ...CONFIG, suggestions: ["Pricing", "Support"] },
			}),
		);
		const card = container.querySelector(".ww-dock .ww-dock-card");
		expect(card?.getAttribute("data-expanded")).toBe("false");
		expect(card?.querySelector(".ww-dock-field")).not.toBeNull();

		const input = container.querySelector(".ww-dock-input") as HTMLInputElement;
		await act(async () => {
			input.dispatchEvent(
				new win.FocusEvent("focusin", { bubbles: true }) as never,
			);
			await wait(120);
		});
		expect(card?.getAttribute("data-expanded")).toBe("true");
	});
});

describe("dock click", () => {
	const panelState = () =>
		container.querySelector(".ww-panel")?.getAttribute("data-state");

	test("expand (default) widens the bar and keeps the panel closed", async () => {
		await renderSettled(
			createElement(FloatingChat, {
				config: { ...CONFIG, suggestions: ["Pricing", "Support"] },
			}),
		);
		const input = container.querySelector(".ww-dock-input") as HTMLInputElement;
		await act(async () => {
			input.dispatchEvent(
				new win.FocusEvent("focusin", { bubbles: true }) as never,
			);
		});
		expect(panelState()).toBe("hidden");
		expect(
			container.querySelector(".ww-dock")?.getAttribute("data-expanded"),
		).toBe("true");
	});

	test("open opens the panel on focus", async () => {
		await renderSettled(
			createElement(FloatingChat, {
				config: {
					...CONFIG,
					suggestions: ["Pricing", "Support"],
					dockClick: "open",
				},
			}),
		);
		const input = container.querySelector(".ww-dock-input") as HTMLInputElement;
		await act(async () => {
			input.dispatchEvent(
				new win.FocusEvent("focusin", { bubbles: true }) as never,
			);
		});
		expect(panelState()).toBe("opening");
	});

	test("open opens the panel on a click while the input already has focus", async () => {
		const ref = createRef<FloatingChatHandle>();
		await renderSettled(
			createElement(FloatingChat, {
				config: { ...CONFIG, dockClick: "open" },
				ref,
			}),
		);
		const input = container.querySelector(".ww-dock-input") as HTMLInputElement;
		await act(async () => {
			input.dispatchEvent(
				new win.MouseEvent("click", { bubbles: true }) as never,
			);
		});
		expect(panelState()).toBe("opening");
	});
});

describe("welcome appearance", () => {
	test("data-appeared waits for the panel to be on screen", async () => {
		const ref = createRef<FloatingChatHandle>();
		await renderSettled(
			createElement(FloatingChat, {
				config: {
					...CONFIG,
					welcomeTitle: "Bonjour",
					suggestions: ["Pricing"],
				},
				ref,
			}),
		);
		const welcome = () => container.querySelector(".ww-panel .ww-welcome");
		expect(welcome()?.getAttribute("data-appeared")).toBe("false");

		await act(async () => {
			ref.current?.open();
		});
		expect(welcome()?.getAttribute("data-appeared")).toBe("true");

		await act(async () => {
			ref.current?.close();
		});
		expect(welcome()?.getAttribute("data-appeared")).toBe("false");

		await act(async () => {
			ref.current?.open();
		});
		expect(welcome()?.getAttribute("data-appeared")).toBe("true");
	});
});

function countScrollListeners() {
	let count = 0;
	const target = win as unknown as {
		addEventListener: (type: string, ...rest: unknown[]) => unknown;
	};
	const original = target.addEventListener.bind(win);
	target.addEventListener = (type, ...rest) => {
		if (type === "scroll") {
			count += 1;
		}
		return original(type, ...rest);
	};
	scrollSpyRestore = () => {
		target.addEventListener = original;
	};
	return () => count;
}

describe("floating bar behaviours", () => {
	test("pointer vars are written on pointermove when enabled", async () => {
		await renderSettled(
			createElement(FloatingChat, {
				config: { ...CONFIG, dockPointerVars: true },
			}),
		);
		const dock = container.querySelector(".ww-dock") as HTMLElement;
		dock.getBoundingClientRect = () =>
			({ left: 100, top: 500, width: 600, height: 60 }) as DOMRect;

		await act(async () => {
			dock.dispatchEvent(
				new win.PointerEvent("pointermove", {
					bubbles: true,
					clientX: 150,
					clientY: 520,
				}) as never,
			);
		});
		expect(dock.style.getPropertyValue("--ww-pointer-x")).toBe("50px");
		expect(dock.style.getPropertyValue("--ww-pointer-y")).toBe("20px");

		await act(async () => {
			dock.dispatchEvent(new win.PointerEvent("pointerleave") as never);
		});
		expect(dock.style.getPropertyValue("--ww-pointer-x")).toBe("");
		expect(dock.style.getPropertyValue("--ww-pointer-y")).toBe("");
	});

	test("pointer vars stay off by default", async () => {
		await renderSettled(createElement(FloatingChat, { config: CONFIG }));
		const dock = container.querySelector(".ww-dock") as HTMLElement;

		await act(async () => {
			dock.dispatchEvent(
				new win.PointerEvent("pointermove", {
					bubbles: true,
					clientX: 150,
					clientY: 520,
				}) as never,
			);
		});
		expect(dock.style.getPropertyValue("--ww-pointer-x")).toBe("");
	});

	test("dock input is read-only on narrow viewports when enabled", async () => {
		setViewportWidth(390);
		await renderSettled(createElement(FloatingChat, { config: CONFIG }));
		const input = container.querySelector(".ww-dock-input") as HTMLInputElement;
		expect(input.readOnly).toBe(true);

		await act(async () => {
			input.dispatchEvent(
				new win.FocusEvent("focusin", { bubbles: true }) as never,
			);
		});
		expect(
			container.querySelector(".ww-panel")?.getAttribute("data-state"),
		).toBe("opening");
	});

	test("dock input stays editable on narrow viewports when disabled", async () => {
		setViewportWidth(390);
		await renderSettled(
			createElement(FloatingChat, {
				config: { ...CONFIG, dockReadonlyMobile: false },
			}),
		);
		const input = container.querySelector(".ww-dock-input") as HTMLInputElement;
		expect(input.readOnly).toBe(false);
	});

	test("dock input stays editable on desktop", async () => {
		await renderSettled(createElement(FloatingChat, { config: CONFIG }));
		const input = container.querySelector(".ww-dock-input") as HTMLInputElement;
		expect(input.readOnly).toBe(false);
	});

	test("the back gesture closes the panel on narrow viewports", async () => {
		setViewportWidth(390);
		const ref = createRef<FloatingChatHandle>();
		await renderSettled(createElement(FloatingChat, { config: CONFIG, ref }));
		const panel = () =>
			container.querySelector(".ww-panel")?.getAttribute("data-state");

		await act(async () => {
			ref.current?.open();
		});
		expect(panel()).toBe("opening");
		expect(win.history.state).toEqual({ waniwaniPanel: true });

		await act(async () => {
			win.history.back();
		});
		expect(panel()).toBe("closing");
		expect(win.history.state).toBeNull();

		await act(async () => {
			ref.current?.open();
		});
		expect(win.history.state).toEqual({ waniwaniPanel: true });
		await act(async () => {
			ref.current?.close();
		});
		expect(panel()).toBe("closing");
		expect(win.history.state).toBeNull();
	});

	test("a stale panel entry left by a reload loses its flag on mount", async () => {
		setViewportWidth(390);
		win.history.replaceState({ waniwaniPanel: true, router: 1 }, "");
		const ref = createRef<FloatingChatHandle>();
		await renderSettled(createElement(FloatingChat, { config: CONFIG, ref }));
		expect(win.history.state).toEqual({ router: 1 });

		await act(async () => {
			ref.current?.open();
		});
		await act(async () => {
			win.history.back();
		});
		expect(
			container.querySelector(".ww-panel")?.getAttribute("data-state"),
		).toBe("closing");
		win.history.replaceState(null, "");
	});

	test("no history entry on desktop", async () => {
		const ref = createRef<FloatingChatHandle>();
		await renderSettled(createElement(FloatingChat, { config: CONFIG, ref }));
		await act(async () => {
			ref.current?.open();
		});
		expect(win.history.state).toBeNull();
	});

	test("always expands the chips without the auto-expand delay", async () => {
		await renderSettled(
			createElement(FloatingChat, {
				config: {
					...CONFIG,
					suggestions: ["Pricing", "Support"],
					dockChipsTrigger: ["always"],
				},
			}),
		);
		await act(async () => {
			await wait(150);
		});
		expect(
			container.querySelector(".ww-dock")?.getAttribute("data-expanded"),
		).toBe("true");
	});

	test("hover and scroll together keep the auto-expand timer", async () => {
		await renderSettled(
			createElement(FloatingChat, {
				config: {
					...CONFIG,
					suggestions: ["Pricing", "Support"],
					dockChipsTrigger: ["hover", "scroll"],
				},
			}),
		);
		await act(async () => {
			await wait(150);
		});
		expect(
			container.querySelector(".ww-dock")?.getAttribute("data-expanded"),
		).toBe("false");
		await act(async () => {
			await wait(1100);
		});
		expect(
			container.querySelector(".ww-dock")?.getAttribute("data-expanded"),
		).toBe("true");
	});

	test("hover and scroll together add one scroll listener over hover alone", async () => {
		const scrollListeners = countScrollListeners();
		const mountWith = async (dockChipsTrigger?: ("hover" | "scroll")[]) => {
			const before = scrollListeners();
			await renderSettled(
				createElement(FloatingChat, {
					config: {
						...CONFIG,
						suggestions: ["Pricing", "Support"],
						dockChipsTrigger,
					},
				}),
			);
			await act(async () => {
				await wait(150);
			});
			const added = scrollListeners() - before;
			act(() => root.unmount());
			root = createRoot(container);
			return added;
		};
		const hoverOnly = await mountWith(["hover"]);
		const hoverAndScroll = await mountWith(["hover", "scroll"]);
		expect(hoverAndScroll).toBe(hoverOnly + 1);
	});

	test("scroll alone expands on a scroll pause and not on the timer", async () => {
		const section = win.document.createElement("section");
		section.id = "pricing";
		win.document.body.appendChild(section);
		const realElementFromPoint = win.document.elementFromPoint;
		win.document.elementFromPoint = () => section as never;
		try {
			await renderSettled(
				createElement(FloatingChat, {
					config: {
						...CONFIG,
						suggestions: ["Pricing", "Support"],
						dockChipsTrigger: ["scroll"],
					},
				}),
			);
			const expanded = () =>
				container.querySelector(".ww-dock")?.getAttribute("data-expanded");
			await act(async () => {
				await wait(1200);
			});
			expect(expanded()).toBe("false");

			Object.defineProperty(win, "scrollY", { value: 300, configurable: true });
			await act(async () => {
				win.dispatchEvent(new win.Event("scroll"));
				await wait(1200);
			});
			expect(expanded()).toBe("true");
		} finally {
			win.document.elementFromPoint = realElementFromPoint;
			section.remove();
			Object.defineProperty(win, "scrollY", { value: 0, configurable: true });
		}
	});

	test("hover waits for the auto-expand delay", async () => {
		await renderSettled(
			createElement(FloatingChat, {
				config: { ...CONFIG, suggestions: ["Pricing", "Support"] },
			}),
		);
		await act(async () => {
			await wait(150);
		});
		expect(
			container.querySelector(".ww-dock")?.getAttribute("data-expanded"),
		).toBe("false");
	});

	test("glow off renders the dock input without the border glow", async () => {
		const GLOW_LAYER = '.ww-dock [class~="ww:-z-[1]"]';
		await renderSettled(
			createElement(FloatingChat, { config: { ...CONFIG, dockGlow: false } }),
		);
		const field = container.querySelector(".ww-dock-field") as HTMLElement;
		expect(field.querySelector(".ww-dock-input")).not.toBeNull();
		expect(field.style.borderRadius).toBe("var(--ww-dock-field-radius)");
		expect(container.querySelector(GLOW_LAYER)).toBeNull();

		act(() => root.unmount());
		root = createRoot(container);
		await renderSettled(createElement(FloatingChat, { config: CONFIG }));
		expect(container.querySelector(GLOW_LAYER)).not.toBeNull();
	});
});

describe("composer box hooks", () => {
	test("renders the composer box and a hidden panel with a close hook", async () => {
		const panelContainer = document.createElement("div");
		document.body.appendChild(panelContainer);
		portalTargets.push(panelContainer);
		await renderSettled(
			createElement(ComposerChat, {
				config: { ...CONFIG, mode: "composer" },
				panelContainer,
			}),
		);

		expect(container.querySelector(".ww-composer")).not.toBeNull();
		expect(
			container
				.querySelector(".ww-composer")
				?.getAttribute("data-composer-variant"),
		).not.toBeNull();
		expect(
			panelContainer.querySelector(".ww-panel")?.getAttribute("data-state"),
		).toBe("hidden");
		expect(panelContainer.querySelector(".ww-panel .ww-close")).not.toBeNull();
	});
});

describe("panel input multiline", () => {
	test("flags the form once the text spans more than one line", async () => {
		await act(async () => {
			root.render(
				createElement(ChatEmbed, {
					api: "https://brand.mock/api/chat",
					skipRemoteConfig: true,
					enableThreadHistory: false,
				}),
			);
		});
		const form = container.querySelector("form.ww-input") as HTMLFormElement;
		const textarea = container.querySelector(
			".ww-textarea",
		) as HTMLTextAreaElement;
		expect(form.getAttribute("data-multiline")).toBe("false");

		await act(async () => {
			setInputValue(textarea, "first line\nsecond line");
		});
		expect(form.getAttribute("data-multiline")).toBe("true");

		await act(async () => {
			setInputValue(textarea, "one line");
		});
		expect(form.getAttribute("data-multiline")).toBe("false");
	});
});

describe("usePanelState", () => {
	const seen: PanelState[] = [];
	const commits: Array<{ open: boolean; state: PanelState }> = [];

	function Harness({ open }: { open: boolean }) {
		const ref = useRef<HTMLDivElement>(null);
		const state = usePanelState(open, ref, { readDuration: () => 10 });
		seen.push(state);
		useLayoutEffect(() => {
			commits.push({ open, state });
		});
		return createElement("div", { ref, "data-state": state });
	}

	const current = () =>
		container.querySelector("div")?.getAttribute("data-state");

	test("runs hidden, opening, shown, closing, hidden", async () => {
		await act(async () => {
			root.render(createElement(Harness, { open: false }));
		});
		expect(current()).toBe("hidden");

		await act(async () => {
			root.render(createElement(Harness, { open: true }));
		});
		expect(current()).toBe("opening");

		await act(async () => {
			await wait(30);
		});
		expect(current()).toBe("shown");

		await act(async () => {
			root.render(createElement(Harness, { open: false }));
		});
		expect(current()).toBe("closing");

		await act(async () => {
			await wait(30);
		});
		expect(current()).toBe("hidden");
	});

	test("a close during opening never lands on shown", async () => {
		await act(async () => {
			root.render(createElement(Harness, { open: false }));
		});
		await act(async () => {
			root.render(createElement(Harness, { open: true }));
		});
		await act(async () => {
			root.render(createElement(Harness, { open: false }));
		});
		expect(current()).toBe("closing");

		seen.length = 0;
		await act(async () => {
			await wait(30);
		});
		expect(current()).toBe("hidden");
		expect(seen).not.toContain("shown");
	});

	test("commits the transient state in the same render the flag flips", async () => {
		await act(async () => {
			root.render(createElement(Harness, { open: false }));
		});
		commits.length = 0;
		await act(async () => {
			root.render(createElement(Harness, { open: true }));
		});
		expect(commits[0]).toEqual({ open: true, state: "opening" });

		await act(async () => {
			await wait(30);
		});
		commits.length = 0;
		await act(async () => {
			root.render(createElement(Harness, { open: false }));
		});
		expect(commits[0]).toEqual({ open: false, state: "closing" });

		await act(async () => {
			await wait(30);
		});
	});

	test("starts shown when mounted open", async () => {
		await act(async () => {
			root.render(createElement(Harness, { open: true }));
		});
		expect(current()).toBe("shown");
	});
});
