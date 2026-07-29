import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";

// ---------------------------------------------------------------------------
// Minimal DOM globals so react-dom/client can mount a hook harness. Unlike
// `use-chat-engine.test.tsx`, `useSuggestions` has no dependency on
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

const { useSuggestions } = await import("../use-suggestions");
type UseSuggestionsOptions = Parameters<typeof useSuggestions>[0];
type UseSuggestionsReturn = ReturnType<typeof useSuggestions>;

const { SUGGESTIONS_META_KEY } = await import("../../../../shared/meta-keys");

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function Harness({
	resultRef,
	options,
}: {
	resultRef: { current: UseSuggestionsReturn | null };
	options: UseSuggestionsOptions;
}) {
	resultRef.current = useSuggestions(options);
	return null;
}

let root: Root;
let container: HTMLElement;
let hookRef: { current: UseSuggestionsReturn | null };

function render(options: UseSuggestionsOptions) {
	act(() => {
		root.render(createElement(Harness, { resultRef: hookRef, options }));
	});
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

// biome-ignore lint/suspicious/noExplicitAny: fixtures stand in for `UIMessage`
type Msg = any;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useSuggestions — conversation reset clears stale pills", () => {
	test("clears flow-driven pills once messages go back to empty, with no `initial` configured", () => {
		// Mount mid-flight so the streaming -> ready transition below fires the
		// hook's recompute effect.
		render({ messages: [], status: "streaming" });

		const turnMessages: Msg[] = [
			userMessage("Which plan?"),
			assistantMessageWithFlowSuggestions(["Bronze", "Silver", "Gold"]),
		];
		render({ messages: turnMessages, status: "ready" });

		expect(hookRef.current?.suggestions).toEqual(["Bronze", "Silver", "Gold"]);

		// Simulate `reset()` / `startNewThread()`: messages go back to empty
		// while status stays "ready". No `initial` was ever configured — this
		// is the common case, since dynamic pills are enabled by default.
		render({ messages: [], status: "ready" });

		expect(hookRef.current?.suggestions).toEqual([]);
		expect(hookRef.current?.source).toBe("initial");
	});

	test("resets to the configured `initial` pills (not last flow pills) once messages go back to empty", () => {
		render({
			messages: [],
			status: "streaming",
			config: { initial: ["Book a demo"] },
		});

		const turnMessages: Msg[] = [
			userMessage("Which plan?"),
			assistantMessageWithFlowSuggestions(["Bronze", "Silver", "Gold"]),
		];
		render({
			messages: turnMessages,
			status: "ready",
			config: { initial: ["Book a demo"] },
		});

		expect(hookRef.current?.suggestions).toEqual(["Bronze", "Silver", "Gold"]);
		expect(hookRef.current?.source).toBe("flow");

		render({
			messages: [],
			status: "ready",
			config: { initial: ["Book a demo"] },
		});

		expect(hookRef.current?.suggestions).toEqual(["Book a demo"]);
		expect(hookRef.current?.source).toBe("initial");
	});
});
