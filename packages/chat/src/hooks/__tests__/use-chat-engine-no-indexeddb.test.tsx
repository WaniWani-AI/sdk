import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { Window } from "happy-dom";

// The chat keeps conversations in an IndexedDB database only for a channel with
// thread history. Without it, mounting the chat must not create that database.

const win = new Window({ url: "https://localhost" });
for (const key of [
	"document",
	"navigator",
	"localStorage",
	"screen",
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
(globalThis as any).IDBKeyRange = IDBKeyRange;
// biome-ignore lint/suspicious/noExplicitAny: test setup
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const React = await import("react");
const { act, createElement } = React;
const { createRoot } = await import("react-dom/client");
type Root = ReturnType<typeof createRoot>;

// @ts-expect-error -- bun:test `mock.module` exists at runtime but has no TS type
mock.module("@ai-sdk/react", () => ({
	useChat() {
		return {
			messages: [],
			sendMessage: () => {},
			setMessages: () => {},
			status: "ready",
			stop: async () => {},
		};
	},
}));

// @ts-expect-error -- bun:test `mock.module` exists at runtime but has no TS type
mock.module("../../lib/lenient-chat-transport", () => ({
	LenientChatTransport: class {},
}));

const { useChatEngine } = await import("../use-chat-engine");

function Harness({ enableThreadHistory }: { enableThreadHistory: boolean }) {
	useChatEngine({
		api: "/api/waniwani",
		skipRemoteConfig: true,
		enableThreadHistory,
	});
	return null;
}

const originalFetch = globalThis.fetch;
let root: Root;
let container: HTMLElement;

beforeEach(() => {
	// biome-ignore lint/suspicious/noExplicitAny: test setup, a fresh empty IndexedDB per case
	(globalThis as any).indexedDB = new IDBFactory();
	localStorage.clear();
	globalThis.fetch = mock(async () =>
		Response.json({ tools: [] }),
	) as unknown as typeof fetch;
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(() => {
	act(() => {
		root.unmount();
	});
	container.remove();
	globalThis.fetch = originalFetch;
});

async function mountAndSettle(enableThreadHistory: boolean): Promise<void> {
	await act(async () => {
		root.render(createElement(Harness, { enableThreadHistory }));
	});
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 50));
	});
}

async function databaseNames(): Promise<string[]> {
	return (await indexedDB.databases()).map((d) => d.name ?? "");
}

describe("useChatEngine and the IndexedDB database", () => {
	test("with thread history off, mounting the chat creates no database", async () => {
		await mountAndSettle(false);
		expect(await databaseNames()).toEqual([]);
	});

	test("with thread history on, mounting the chat opens the conversation database", async () => {
		await mountAndSettle(true);
		expect(await databaseNames()).toEqual(["waniwani-threads"]);
	});
});
