import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { UIMessage } from "ai";
import { Window } from "happy-dom";
import { PARTS } from "../parts";

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
	"IntersectionObserver",
	"ResizeObserver",
	"HTMLFormElement",
	"HTMLInputElement",
	"HTMLTextAreaElement",
	"KeyboardEvent",
	"localStorage",
	"matchMedia",
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
const { ChatEmbed } = await import("../layouts/chat-embed");
const { MessageList } = await import("../components/message-list");

const SEEDED_MESSAGES: UIMessage[] = [
	{
		id: "u1",
		role: "user",
		parts: [{ type: "text", text: "Can you help me get started?" }],
	},
	{
		id: "a1",
		role: "assistant",
		parts: [{ type: "text", text: "Absolutely, tell me what you need." }],
	},
];

const CHROME_PARTS = [
	"ww-root",
	"ww-content",
	"ww-header",
	"ww-header-title",
	"ww-header-actions",
	"ww-thread",
	"ww-input",
	"ww-textarea",
	"ww-send",
	"ww-footer",
	"ww-disclaimer",
	"ww-disclaimer-link",
	"ww-powered-by",
];

let container: HTMLElement;
let root: ReturnType<typeof createRoot>;

afterEach(() => {
	act(() => root?.unmount());
	container?.remove();
});

describe("chat chrome parts", () => {
	test("renders every part the chrome owns", async () => {
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
		await act(async () => {
			root.render(
				createElement(ChatEmbed, {
					api: "https://brand.mock/api/chat",
					skipRemoteConfig: true,
					title: "Assistant",
					disclaimer: "AI agent. [Learn more](https://brand.mock/about)",
					enableThreadHistory: false,
					headerActions: createElement("span", { id: "action" }),
					initialMessages: SEEDED_MESSAGES,
				}),
			);
		});

		const missing = CHROME_PARTS.filter(
			(part) => container.querySelector(`.${part}`) === null,
		);
		expect(missing).toEqual([]);
		expect(
			container.querySelector(".ww-header-actions #action"),
		).not.toBeNull();
		const form = container.querySelector("form.ww-input");
		expect(form?.getAttribute("data-empty")).toBe("true");
		expect(form?.getAttribute("data-streaming")).toBeNull();
		expect(container.querySelector(".ww-root")?.hasAttribute("data-mode")).toBe(
			false,
		);
	});

	test("renders data-mode on the root when an embed host passes its mode", async () => {
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
		await act(async () => {
			root.render(
				createElement(ChatEmbed, {
					api: "https://brand.mock/api/chat",
					skipRemoteConfig: true,
					enableThreadHistory: false,
					mode: "inline",
				}),
			);
		});

		expect(container.querySelector(".ww-root")?.getAttribute("data-mode")).toBe(
			"inline",
		);
	});

	test("omits the header actions wrapper when there are no actions", async () => {
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
		await act(async () => {
			root.render(
				createElement(ChatEmbed, {
					api: "https://brand.mock/api/chat",
					skipRemoteConfig: true,
					title: "Assistant",
					enableThreadHistory: false,
					initialMessages: SEEDED_MESSAGES,
				}),
			);
		});

		expect(container.querySelector(".ww-header")).not.toBeNull();
		expect(container.querySelector(".ww-header-actions")).toBeNull();
	});

	test("renders the activity, suggestion and welcome parts", async () => {
		const activityMessages = [
			{
				id: "a1",
				role: "assistant",
				parts: [{ type: "reasoning", text: "Let me think", state: "done" }],
			},
			{
				id: "a2",
				role: "assistant",
				parts: [
					{
						type: "tool-lookup",
						toolCallId: "call-1",
						state: "output-available",
						input: {},
						output: { content: [{ type: "text", text: "ok" }] },
					},
				],
			},
			{
				id: "u1",
				role: "user",
				parts: [{ type: "text", text: "Hello" }],
			},
		] as UIMessage[];

		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
		await act(async () => {
			root.render(
				createElement(MessageList, {
					messages: activityMessages,
					status: "submitted",
				}),
			);
		});
		expect(container.querySelector(".ww-loader")).not.toBeNull();
		expect(
			container.querySelector(".ww-reasoning .ww-reasoning-toggle"),
		).not.toBeNull();
		expect(container.querySelector(".ww-tool")).not.toBeNull();

		act(() => root.unmount());
		container.remove();
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
		await act(async () => {
			root.render(
				createElement(ChatEmbed, {
					api: "https://brand.mock/api/chat",
					skipRemoteConfig: true,
					title: "Assistant",
					enableThreadHistory: false,
					suggestions: {
						page: null,
						channel: [
							{ id: null, text: "a" },
							{ id: null, text: "b" },
						],
					},
					welcome: { title: "Hi", description: "d", suggestions: ["x"] },
				}),
			);
		});
		expect(
			container.querySelectorAll(".ww-suggestions .ww-suggestion").length,
		).toBe(2);
		const pill = container.querySelector(".ww-suggestions .ww-suggestion");
		expect(pill?.getAttribute("data-origin")).toBe("channel");
		expect(pill?.getAttribute("data-index")).toBe("0");
		expect(
			container.querySelector(".ww-welcome .ww-welcome-title")?.textContent,
		).toBe("Hi");
		expect(
			container.querySelector(".ww-welcome")?.getAttribute("data-appeared"),
		).toBe("true");
		expect(
			container.querySelectorAll(".ww-welcome-suggestions .ww-suggestion")
				.length,
		).toBe(1);
	});

	test("renders the avatar only in its configured slots", async () => {
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
		await act(async () => {
			root.render(
				createElement(ChatEmbed, {
					api: "https://brand.mock/api/chat",
					skipRemoteConfig: true,
					title: "Assistant",
					enableThreadHistory: false,
					initialMessages: SEEDED_MESSAGES,
					avatar: { src: "https://x/a.svg", slots: ["header", "composer"] },
				}),
			);
		});

		expect(
			container.querySelector(".ww-header .ww-avatar[data-slot=header]"),
		).not.toBeNull();
		expect(
			container.querySelector(".ww-input .ww-avatar[data-slot=composer]"),
		).not.toBeNull();
		expect(container.querySelector(".ww-message .ww-avatar")).toBeNull();
	});

	test("renders the message avatar beside assistant rows only", async () => {
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
		await act(async () => {
			root.render(
				createElement(ChatEmbed, {
					api: "https://brand.mock/api/chat",
					skipRemoteConfig: true,
					enableThreadHistory: false,
					initialMessages: SEEDED_MESSAGES,
					avatar: { src: "https://x/a.svg", slots: ["message"] },
				}),
			);
		});

		expect(
			container.querySelectorAll(".ww-message .ww-avatar[data-slot=message]")
				.length,
		).toBe(1);
		expect(
			container.querySelector(".ww-message-assistant .ww-avatar"),
		).not.toBeNull();
		expect(container.querySelector(".ww-message-user .ww-avatar")).toBeNull();
	});

	test("renders no avatar element without an avatar", async () => {
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
		await act(async () => {
			root.render(
				createElement(ChatEmbed, {
					api: "https://brand.mock/api/chat",
					skipRemoteConfig: true,
					title: "Assistant",
					enableThreadHistory: false,
					initialMessages: SEEDED_MESSAGES,
				}),
			);
		});

		expect(container.querySelector(".ww-avatar")).toBeNull();
	});

	test("structured welcome takes the pill row and shows it once", async () => {
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
		await act(async () => {
			root.render(
				createElement(ChatEmbed, {
					api: "https://brand.mock/api/chat",
					skipRemoteConfig: true,
					enableThreadHistory: false,
					welcomeVariant: "pills",
					avatar: { src: "https://x/a.svg", slots: ["welcome", "header"] },
					suggestions: {
						page: null,
						channel: [
							{ id: null, text: "a" },
							{ id: null, text: "b" },
						],
					},
					welcome: {
						title: "Bonjour,|parlez-nous de votre projet",
						description: "One",
						subtitles: ["One", "Two"],
						subtitleRotateMs: 3600,
					},
				}),
			);
		});

		const welcome = container.querySelector(".ww-welcome");
		expect(welcome?.getAttribute("data-appeared")).toBe("true");
		expect(
			welcome?.querySelector(".ww-avatar[data-slot=welcome]"),
		).not.toBeNull();
		const title = welcome?.querySelector(".ww-welcome-title");
		expect(title?.querySelectorAll("br").length).toBe(1);
		expect(title?.textContent).toBe("Bonjour,parlez-nous de votre projet");
		expect(welcome?.querySelector(".ww-welcome-subtitle")?.textContent).toBe(
			"One",
		);
		expect(
			container.querySelectorAll(".ww-welcome-suggestions .ww-suggestion")
				.length,
		).toBe(2);
		expect(container.querySelectorAll(".ww-suggestion").length).toBe(2);
	});

	test("structured welcome shows a bare avatar file name as an image, not text", async () => {
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
		await act(async () => {
			root.render(
				createElement(ChatEmbed, {
					api: "https://brand.mock/api/chat",
					skipRemoteConfig: true,
					enableThreadHistory: false,
					welcomeVariant: "pills",
					avatar: { src: "bot.png", slots: ["welcome"] },
					welcome: { title: "Hi" },
				}),
			);
		});

		const img = container.querySelector(
			".ww-welcome .ww-avatar[data-slot=welcome]",
		);
		expect(img?.getAttribute("src")).toBe("https://shop.example.com/bot.png");
		expect(container.querySelector(".ww-welcome")?.textContent).not.toContain(
			"bot.png",
		);
	});

	test("structured welcome reads its title from the wording overrides", async () => {
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
		await act(async () => {
			root.render(
				createElement(ChatEmbed, {
					api: "https://brand.mock/api/chat",
					skipRemoteConfig: true,
					enableThreadHistory: false,
					welcomeVariant: "pills",
					locale: "en",
					messages: { welcome: { title: "Hello", subtitle: "Ask away" } },
				}),
			);
		});

		expect(
			container.querySelector(".ww-welcome .ww-welcome-title")?.textContent,
		).toBe("Hello");
		expect(
			container.querySelector(".ww-welcome .ww-welcome-subtitle")?.textContent,
		).toBe("Ask away");
	});
});

describe("composer row part", () => {
	test("the row inside the form holds the textarea and the send button", async () => {
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
		await act(async () => {
			root.render(
				createElement(ChatEmbed, {
					api: "https://brand.mock/api/chat",
					skipRemoteConfig: true,
					enableThreadHistory: false,
				}),
			);
		});

		const row = container.querySelector("form.ww-input .ww-input-row");
		expect(row).not.toBeNull();
		expect(row?.querySelector(".ww-textarea")).not.toBeNull();
		expect(row?.querySelector(".ww-send")).not.toBeNull();
	});
});

describe("table toolbar", () => {
	const TABLE_MESSAGES: UIMessage[] = [
		{
			id: "a1",
			role: "assistant",
			parts: [{ type: "text", text: "| A | B |\n| --- | --- |\n| 1 | 2 |" }],
		},
	];

	async function renderTable(showTableToolbar?: boolean) {
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
		await act(async () => {
			root.render(
				createElement(MessageList, {
					messages: TABLE_MESSAGES,
					status: "ready",
					showTableToolbar,
				}),
			);
		});
		return container.querySelector('[data-streamdown="table-wrapper"]');
	}

	test("shows the copy and download toolbar by default", async () => {
		const wrapper = await renderTable();
		expect(wrapper?.querySelector("table")).not.toBeNull();
		expect(wrapper?.querySelectorAll("button").length).toBeGreaterThan(0);
	});

	test("showTableToolbar false keeps the table and drops the toolbar", async () => {
		const wrapper = await renderTable(false);
		expect(wrapper?.querySelector("table")).not.toBeNull();
		expect(wrapper?.querySelectorAll("button").length).toBe(0);
	});
});

describe("docs", () => {
	const themingDocs = join(
		import.meta.dir,
		"../../../../../docs-site/docs/sdk/chat/theming.mdx",
	);

	if (existsSync(themingDocs)) {
		test("docs list every part", () => {
			const docs = readFileSync(themingDocs, "utf8");
			const undocumented = Object.values(PARTS).filter(
				(part) => !docs.includes(`\`.${part}\``),
			);
			expect(undocumented).toEqual([]);
		});
	}
});
