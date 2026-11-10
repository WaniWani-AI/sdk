import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	mock,
	test,
} from "bun:test";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { Window } from "happy-dom";

const win = new Window({ url: "https://localhost" });
Object.assign(globalThis, {
	indexedDB: new IDBFactory(),
	IDBKeyRange,
	window: win,
});
for (const key of [
	"document",
	"navigator",
	"HTMLElement",
	"HTMLDivElement",
	"HTMLAnchorElement",
	"HTMLButtonElement",
	"HTMLTextAreaElement",
	"MutationObserver",
	"IntersectionObserver",
	"customElements",
	"Element",
	"Node",
	"Text",
	"Comment",
	"DocumentFragment",
	"Event",
	"CustomEvent",
	"MouseEvent",
	"KeyboardEvent",
	"requestAnimationFrame",
	"cancelAnimationFrame",
	"getComputedStyle",
]) {
	Reflect.set(globalThis, key, Reflect.get(win, key));
}
// happy-dom's selector parser needs `window.SyntaxError`, which Bun leaves unset.
Reflect.set(win, "SyntaxError", SyntaxError);

const { createElement } = await import("react");
const { flushSync } = await import("react-dom");
const { createRoot } = await import("react-dom/client");
type Root = ReturnType<typeof createRoot>;

type ChatState = {
	messages: unknown[];
	status: "ready" | "streaming";
};

const IDLE: ChatState = { messages: [], status: "ready" };
let chat: ChatState = IDLE;

// The real `useChat` hands back stable callbacks, so the mock does too.
const sendMessage = mock(() => {});
const setMessages = mock(() => {});
const stop = mock(() => {});
const addToolOutput = mock(() => {});

// @ts-expect-error -- bun:test `mock.module` exists at runtime but has no TS type
mock.module("@ai-sdk/react", () => ({
	useChat() {
		return { ...chat, sendMessage, setMessages, stop, addToolOutput };
	},
}));

// @ts-expect-error -- bun:test `mock.module` exists at runtime but has no TS type
mock.module("../../lib/lenient-chat-transport", () => ({
	LenientChatTransport: class {},
}));

const originalFetch = globalThis.fetch;
const previousActEnvironment = Reflect.get(
	globalThis,
	"IS_REACT_ACT_ENVIRONMENT",
);
beforeAll(() => {
	// The keystrokes run outside act(), as they do in a browser.
	Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", false);
});
afterAll(() => {
	Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", previousActEnvironment);
});
beforeEach(() => {
	Reflect.set(
		globalThis,
		"fetch",
		mock(async () => Response.json({ tools: [] })),
	);
});

const { ChatEmbed } = await import("../chat-embed");

let root: Root | null = null;
let container: HTMLElement | null = null;

afterEach(() => {
	root?.unmount();
	root = null;
	container?.remove();
	container = null;
	chat = IDLE;
	Reflect.set(globalThis, "fetch", originalFetch);
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function renderComposer() {
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	flushSync(() => {
		root?.render(
			createElement(ChatEmbed, {
				api: "https://example.com/api/chat",
				locale: "en",
				skipRemoteConfig: true,
				enableThreadHistory: false,
			}),
		);
	});
	const field = container.querySelector("textarea");
	if (!field) {
		throw new Error("ChatEmbed rendered no composer textarea");
	}
	for (let i = 0; i < 40 && field.placeholder === ""; i++) {
		await sleep(50);
	}
	return field;
}

// One `input` event per character in one task, with no scheduler turn between them, as a dictation or automation tool types.
function typeInOneTask(field: HTMLTextAreaElement, count: number) {
	const errors: unknown[] = [];
	const record = (error: unknown) => {
		errors.push(error);
	};
	process.on("uncaughtException", record);
	const setValue = Object.getOwnPropertyDescriptor(
		Object.getPrototypeOf(field),
		"value",
	)?.set;
	try {
		for (let i = 0; i < count; i++) {
			setValue?.call(field, `${field.value}a`);
			field.dispatchEvent(new Event("input", { bubbles: true }));
		}
	} finally {
		process.off("uncaughtException", record);
	}
	return errors;
}

describe("ChatEmbed composer under fast input", () => {
	test("keeps 300 characters typed in one task while the placeholder animates", async () => {
		const field = await renderComposer();
		expect(field.placeholder).not.toBe("");

		const errors = typeInOneTask(field, 300);

		expect(errors).toEqual([]);
		expect(field.value).toBe("a".repeat(300));
		await sleep(50);
		expect(field.value).toBe("a".repeat(300));
		expect(field.placeholder).toBe("");
	});

	test("keeps 300 characters typed in one task while a reply streams", async () => {
		chat = {
			status: "streaming",
			messages: [
				{
					id: "u1",
					role: "user",
					parts: [{ type: "text", text: "Which savings account fits me?" }],
				},
				{
					id: "a1",
					role: "assistant",
					parts: [
						{
							type: "text",
							text: "Here are three accounts that match what you told me about your savings goals. ".repeat(
								8,
							),
							state: "streaming",
						},
					],
				},
			],
		};
		const field = await renderComposer();
		const reply = () =>
			[...(container?.querySelectorAll(".ww-message") ?? [])].at(-1)
				?.textContent ?? "";
		const before = reply();
		await sleep(100);
		expect(reply().length).toBeGreaterThan(before.length);

		const errors = typeInOneTask(field, 300);

		expect(errors).toEqual([]);
		expect(field.value).toBe("a".repeat(300));
	});
});
