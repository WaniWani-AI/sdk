import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { Window } from "happy-dom";
import type { ChatTransportContext, ChatTransportFactory } from "../../@types";

// biome-ignore lint/suspicious/noExplicitAny: test setup
(globalThis as any).indexedDB = new IDBFactory();
// biome-ignore lint/suspicious/noExplicitAny: test setup
(globalThis as any).IDBKeyRange = IDBKeyRange;

const win = new Window({ url: "https://localhost" });
for (const key of [
	"document",
	"navigator",
	"localStorage",
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
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const { act, createElement } = await import("react");
const { createRoot } = await import("react-dom/client");
type Root = ReturnType<typeof createRoot>;

let capturedTransportBody: (() => Record<string, unknown>) | undefined;
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
	LenientChatTransport: class {
		constructor(opts: { body?: () => Record<string, unknown> }) {
			capturedTransportBody = opts.body;
		}
	},
}));

const originalFetch = globalThis.fetch;

const { useChatEngine } = await import("../use-chat-engine");
type EngineProps = Parameters<typeof useChatEngine>[0];

const AMPLITUDE_DEVICE_ID = "3b241101-e2bb-4255-8caf-4136c566a962";
const ID_KEY = "waniwani-visitor-id";

function Harness(props: EngineProps) {
	useChatEngine(props);
	return null;
}

let root: Root;
let container: HTMLElement;

beforeEach(() => {
	localStorage.clear();
	capturedTransportBody = undefined;
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

async function mount(props: Partial<EngineProps>) {
	await act(async () => {
		root.render(createElement(Harness, { api: "/api/waniwani", ...props }));
		await new Promise((resolve) => setTimeout(resolve, 20));
	});
}

function visitorOf(body: Record<string, unknown> | undefined) {
	const visitor = body?.visitor;
	if (typeof visitor !== "object" || visitor === null) {
		throw new Error("the request body carries no visitor");
	}
	return visitor as Record<string, unknown>;
}

describe("useChatEngine: the chat request says where the visitor id came from", () => {
	test("a visitorId the page passes goes out as that id with source customer", async () => {
		await mount({ visitorId: AMPLITUDE_DEVICE_ID });

		const visitor = visitorOf(capturedTransportBody?.());

		expect(visitor.id).toBe(AMPLITUDE_DEVICE_ID);
		expect(visitor.idSource).toBe("customer");
	});

	test("with no visitorId the minted id goes out with source generated", async () => {
		await mount({});

		const visitor = visitorOf(capturedTransportBody?.());

		expect(typeof visitor.id).toBe("string");
		expect(visitor.idSource).toBe("generated");
	});

	test("an id stored by an older chat, with no source beside it, goes out as generated", async () => {
		localStorage.setItem(ID_KEY, AMPLITUDE_DEVICE_ID);

		await mount({});

		const visitor = visitorOf(capturedTransportBody?.());
		expect(visitor.id).toBe(AMPLITUDE_DEVICE_ID);
		expect(visitor.idSource).toBe("generated");
	});

	test("a visitor object in the caller's body keeps its other fields and gets the id and source", async () => {
		await mount({
			visitorId: AMPLITUDE_DEVICE_ID,
			body: { visitor: { geo: { country: "FR" } } },
		});

		const visitor = visitorOf(capturedTransportBody?.());

		expect(visitor.geo).toEqual({ country: "FR" });
		expect(visitor.idSource).toBe("customer");
	});

	test("a custom transport's body carries the page-set id and source customer", async () => {
		let context: ChatTransportContext | undefined;
		const transport: ChatTransportFactory = (received) => {
			context = received;
			return {
				sendMessages: (request) => received.fallback.sendMessages(request),
				reconnectToStream: async () => null,
			};
		};

		await mount({ visitorId: AMPLITUDE_DEVICE_ID, transport });

		const visitor = visitorOf(context?.body());
		expect(visitor).toEqual({ id: AMPLITUDE_DEVICE_ID, idSource: "customer" });
	});

	test("a custom transport's body carries a minted id with source generated", async () => {
		let context: ChatTransportContext | undefined;
		const transport: ChatTransportFactory = (received) => {
			context = received;
			return {
				sendMessages: (request) => received.fallback.sendMessages(request),
				reconnectToStream: async () => null,
			};
		};

		await mount({ transport });

		expect(visitorOf(context?.body()).idSource).toBe("generated");
	});
});
