import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";

// ---------------------------------------------------------------------------
// Minimal DOM globals so react-dom/client can mount a hook harness. Unlike
// `use-chat-engine.test.tsx`, `useSuggestionRow` has no dependency on
// `@ai-sdk/react`, IndexedDB, or the transport layer, so none of that mocking
// is needed here — just enough DOM for `createRoot` + `act`.
// ---------------------------------------------------------------------------

const win = new Window({ url: "https://localhost" });
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
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const { act, createElement } = await import("react");
const { createRoot } = await import("react-dom/client");
type Root = ReturnType<typeof createRoot>;

const { useSuggestionRow } = await import("../use-suggestion-row");
type UseSuggestionRowOptions = Parameters<typeof useSuggestionRow>[0];
type UseSuggestionRowReturn = ReturnType<typeof useSuggestionRow>;

const { SUGGESTIONS_META_KEY } = await import("../../../../shared/meta-keys");

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function Harness({
	resultRef,
	options,
}: {
	resultRef: { current: UseSuggestionRowReturn | null };
	options: UseSuggestionRowOptions;
}) {
	resultRef.current = useSuggestionRow(options);
	return null;
}

let root: Root;
let container: HTMLElement;
let hookRef: { current: UseSuggestionRowReturn | null };

function render(options: UseSuggestionRowOptions) {
	act(() => {
		root.render(createElement(Harness, { resultRef: hookRef, options }));
	});
}

/**
 * Like {@link Harness}, but records the `suggestions` array returned on
 * every render — proves the pre-chat row settles in a single commit, i.e.
 * the `useState` initializer and the pre-chat effect share one array
 * reference instead of each building their own `.map()` result.
 */
function RenderTrackingHarness({
	resultRef,
	renderedSuggestionsRef,
	options,
}: {
	resultRef: { current: UseSuggestionRowReturn | null };
	renderedSuggestionsRef: { current: string[][] };
	options: UseSuggestionRowOptions;
}) {
	const result = useSuggestionRow(options);
	renderedSuggestionsRef.current.push(result.suggestions);
	resultRef.current = result;
	return null;
}

beforeEach(() => {
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	hookRef = { current: null };
});

afterEach(() => {
	act(() => {
		root.unmount();
	});
	container.remove();
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function userMessage(text: string) {
	return { id: "u1", role: "user", parts: [{ type: "text", text }] };
}

/** An assistant message carrying flow-driven suggestion pills. */
function assistantMessageWithFlowSuggestions(suggestions: string[]) {
	return {
		id: "a1",
		role: "assistant",
		parts: [
			{
				type: "tool-my_flow",
				toolCallId: "call-1",
				state: "output-available",
				output: {
					content: [{ type: "text", text: "{}" }],
					_meta: { [SUGGESTIONS_META_KEY]: { suggestions } },
				},
			},
		],
	};
}

/** An assistant message carrying a streamed `data-suggestions` (followup) part. */
function assistantMessageWithFollowupSuggestions(
	suggestions: string[],
	id = "a-followup",
) {
	return {
		id,
		role: "assistant",
		parts: [
			{ type: "text", text: "Here you go." },
			{ type: "data-suggestions", data: { suggestions } },
		],
	};
}

// biome-ignore lint/suspicious/noExplicitAny: fixtures stand in for `UIMessage`
type Msg = any;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const PAGE = [{ id: "p1", text: "Page one" }];
const CONFIGURED = { page: PAGE, channel: [{ id: null, text: "Fixed one" }] };
const CHANNEL_ONLY = { page: null, channel: [{ id: null, text: "Fixed one" }] };

describe("pre-chat row", () => {
	test("page prompts render with origin page while the conversation is empty", () => {
		render({ messages: [], status: "ready", suggestions: CONFIGURED });
		expect(hookRef.current?.suggestions).toEqual(["Page one"]);
		expect(hookRef.current?.source).toBe("page");
	});

	test("channel prompts render when no page matches", () => {
		render({ messages: [], status: "ready", suggestions: CHANNEL_ONLY });
		expect(hookRef.current?.suggestions).toEqual(["Fixed one"]);
		expect(hookRef.current?.source).toBe("channel");
	});

	test("no candidates and no messages renders nothing", () => {
		render({ messages: [], status: "ready" });
		expect(hookRef.current?.suggestions).toEqual([]);
	});

	test("suggestions: false renders nothing even with candidates", () => {
		render({
			messages: [],
			status: "ready",
			suggestions: false,
		});
		expect(hookRef.current?.suggestions).toEqual([]);
	});
});

describe("pre-chat row identity", () => {
	test("settles in a single render — no phantom re-render from the pre-chat effect", () => {
		const renderedSuggestionsRef: { current: string[][] } = { current: [] };
		act(() => {
			root.render(
				createElement(RenderTrackingHarness, {
					resultRef: hookRef,
					renderedSuggestionsRef,
					options: { messages: [], status: "ready", suggestions: CONFIGURED },
				}),
			);
		});
		expect(renderedSuggestionsRef.current).toHaveLength(1);
		expect(renderedSuggestionsRef.current[0]).toBe(
			hookRef.current?.suggestions,
		);
	});

	test("keeps the same suggestions array reference when the candidates are unchanged", () => {
		const options: UseSuggestionRowOptions = {
			messages: [],
			status: "ready",
			suggestions: CONFIGURED,
		};
		render(options);
		const first = hookRef.current?.suggestions;
		render(options);
		expect(hookRef.current?.suggestions).toBe(first);
	});
});

describe("per-turn resolution", () => {
	test("a user message clears the row", () => {
		render({ messages: [], status: "ready", suggestions: CONFIGURED });
		const messages: Msg[] = [userMessage("Hi")];
		render({ messages, status: "submitted", suggestions: CONFIGURED });
		expect(hookRef.current?.suggestions).toEqual([]);
	});

	test("flow pills render with zero config (flow is always active)", () => {
		const messages: Msg[] = [
			userMessage("Hi"),
			assistantMessageWithFlowSuggestions(["Flow A", "Flow B"]),
		];
		render({ messages, status: "streaming", suggestions: CONFIGURED });
		render({ messages, status: "ready", suggestions: CONFIGURED });
		expect(hookRef.current?.suggestions).toEqual(["Flow A", "Flow B"]);
		expect(hookRef.current?.source).toBe("flow");
	});

	test("followup pills render when the turn has no flow entry", () => {
		const messages: Msg[] = [
			userMessage("Hi"),
			assistantMessageWithFollowupSuggestions(["F1"]),
		];
		render({ messages, status: "streaming", suggestions: CONFIGURED });
		render({ messages, status: "ready", suggestions: CONFIGURED });
		expect(hookRef.current?.suggestions).toEqual(["F1"]);
		expect(hookRef.current?.source).toBe("followup");
	});

	test("an empty flow entry clears the row even when a followup arrived", () => {
		const parts = [
			...assistantMessageWithFlowSuggestions([]).parts,
			...assistantMessageWithFollowupSuggestions(["F1"]).parts,
		];
		const messages: Msg[] = [
			userMessage("Hi"),
			{ id: "a1", role: "assistant", parts },
		];
		render({ messages, status: "streaming", suggestions: CONFIGURED });
		render({ messages, status: "ready", suggestions: CONFIGURED });
		expect(hookRef.current?.suggestions).toEqual([]);
	});

	test("a turn with no suggestions clears the row", () => {
		const messages: Msg[] = [
			userMessage("Hi"),
			{ id: "a1", role: "assistant", parts: [{ type: "text", text: "Hello" }] },
		];
		render({ messages, status: "streaming", suggestions: CONFIGURED });
		render({ messages, status: "ready", suggestions: CONFIGURED });
		expect(hookRef.current?.suggestions).toEqual([]);
	});

	test("suggestions: false suppresses flow pills too", () => {
		const messages: Msg[] = [
			userMessage("Hi"),
			assistantMessageWithFlowSuggestions(["Flow A"]),
		];
		render({
			messages,
			status: "streaming",
			suggestions: false,
		});
		render({
			messages,
			status: "ready",
			suggestions: false,
		});
		expect(hookRef.current?.suggestions).toEqual([]);
	});
});

describe("reset", () => {
	test("emptying messages restores the pre-chat row and drops leftover flow pills", () => {
		const messages: Msg[] = [
			userMessage("Hi"),
			assistantMessageWithFlowSuggestions(["Flow A"]),
		];
		render({ messages, status: "streaming", suggestions: CONFIGURED });
		render({ messages, status: "ready", suggestions: CONFIGURED });
		expect(hookRef.current?.source).toBe("flow");
		render({ messages: [], status: "ready", suggestions: CONFIGURED });
		expect(hookRef.current?.suggestions).toEqual(["Page one"]);
		expect(hookRef.current?.source).toBe("page");
	});
});
