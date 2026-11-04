import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";

// ---------------------------------------------------------------------------
// Minimal DOM globals so react-dom/client can mount a hook harness. The hook
// only subscribes to an emitter and POSTs, so the transport layer and
// `@ai-sdk/react` never come into it.
// ---------------------------------------------------------------------------

const win = new Window({ url: "https://shop.example/pricing" });
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
	"localStorage",
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

const { useSuggestionIngest } = await import("../use-suggestion-ingest");
type Options = Parameters<typeof useSuggestionIngest>[0];
const { createWidgetEventEmitter } = await import("../../embed/widget-events");

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function Harness({ options }: { options: Options }) {
	useSuggestionIngest(options);
	return null;
}

let root: Root;
let container: HTMLElement;
let fetchMock: ReturnType<typeof mock>;
const originalFetch = globalThis.fetch;

const PAGE_PROMPTS = [{ id: "prompt_1", text: "Do you want a website?" }];

function baseOptions(): Omit<Options, "widgetEvents"> {
	return {
		api: "https://app.waniwani.ai/api/mcp/chat",
		token: "wwp_test",
		channelId: "chan_1",
		source: "web",
		mode: "inline",
		pagePrompts: PAGE_PROMPTS,
		getSessionId: () => "sess_1",
	};
}

/** Mount the hook against a live emitter and return it. */
function mount(overrides: Partial<Options> = {}) {
	const widgetEvents = createWidgetEventEmitter({ mode: "inline" });
	const options = { ...baseOptions(), widgetEvents, ...overrides } as Options;
	act(() => {
		root.render(createElement(Harness, { options }));
	});
	return widgetEvents;
}

/** The single event of the nth POSTed batch. */
function postedEvent(call: number): Record<string, unknown> {
	const [, init] = fetchMock.mock.calls[call] as [string, RequestInit];
	const body = JSON.parse(init.body as string) as {
		events: Record<string, unknown>[];
	};
	return body.events[0] as Record<string, unknown>;
}

beforeEach(() => {
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	fetchMock = mock(async () => new Response("{}", { status: 200 }));
	globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
	act(() => {
		root.unmount();
	});
	container.remove();
	globalThis.fetch = originalFetch;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useSuggestionIngest", () => {
	test("POSTs suggestion.shown for a rendered set, attributing authored ids", async () => {
		const events = mount();

		await act(async () => {
			events.emit({
				name: "suggestions.shown",
				properties: {
					texts: ["Do you want a website?", "Over 65"],
					origin: "page",
				},
			});
		});

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(postedEvent(0)).toMatchObject({
			name: "suggestion.shown",
			properties: {
				origin: "page",
				count: 2,
				channelId: "chan_1",
				mode: "inline",
				prompts: [
					{ id: "prompt_1", text: "Do you want a website?" },
					{ id: null, text: "Over 65" },
				],
			},
		});
	});

	test("POSTs suggestion.clicked for a flow pill, which carries no authored id", async () => {
		const events = mount();

		await act(async () => {
			events.emit({
				name: "suggestion.clicked",
				properties: { text: "Over 65", index: 1, origin: "flow" },
			});
		});

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(postedEvent(0)).toMatchObject({
			name: "suggestion.clicked",
			properties: { origin: "flow", text: "Over 65", index: 1, promptId: null },
		});
	});

	test("reads the session id at emit time, not at subscribe time", async () => {
		let sessionId: string | undefined;
		const events = mount({ getSessionId: () => sessionId });

		await act(async () => {
			events.emit({
				name: "suggestions.shown",
				properties: { texts: ["Over 65"], origin: "flow" },
			});
		});
		// `JSON.stringify` drops an undefined session id, so the first event
		// carries visitor identity only.
		expect(postedEvent(0).correlation).not.toHaveProperty("sessionId");

		sessionId = "sess_late";
		await act(async () => {
			events.emit({
				name: "suggestion.clicked",
				properties: { text: "Over 65", index: 0, origin: "flow" },
			});
		});
		expect(postedEvent(1).correlation).toMatchObject({
			sessionId: "sess_late",
		});
	});

	test("sends nothing without a public token", async () => {
		const events = mount({ token: undefined });

		await act(async () => {
			events.emit({
				name: "suggestions.shown",
				properties: { texts: ["Over 65"], origin: "flow" },
			});
		});

		expect(fetchMock).not.toHaveBeenCalled();
	});

	test("ignores widget events that are not suggestion events", async () => {
		const events = mount();

		await act(async () => {
			events.emit({ name: "chat.opened" });
		});

		expect(fetchMock).not.toHaveBeenCalled();
	});
});
