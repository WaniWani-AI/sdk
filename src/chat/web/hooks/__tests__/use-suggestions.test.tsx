import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import type { SuggestionOrigin } from "../../@types";

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

describe("useSuggestions — conversation reset clears stale pills", () => {
	test("clears flow-driven pills once messages go back to empty, with no `initial` configured", () => {
		// Mount mid-flight so the streaming -> ready transition below fires the
		// hook's recompute effect. Flow pills are opt-in, so the host passes
		// `origins: ["flow"]`.
		render({
			messages: [],
			status: "streaming",
			config: { origins: ["flow"] },
		});

		const turnMessages: Msg[] = [
			userMessage("Which plan?"),
			assistantMessageWithFlowSuggestions(["Bronze", "Silver", "Gold"]),
		];
		render({
			messages: turnMessages,
			status: "ready",
			config: { origins: ["flow"] },
		});

		expect(hookRef.current?.suggestions).toEqual(["Bronze", "Silver", "Gold"]);

		// Simulate `reset()` / `startNewThread()`: messages go back to empty
		// while status stays "ready". No `initial` was ever configured.
		render({ messages: [], status: "ready", config: { origins: ["flow"] } });

		expect(hookRef.current?.suggestions).toEqual([]);
		expect(hookRef.current?.source).toBe("channel");
	});

	test("resets to the configured `initial` pills (not last flow pills) once messages go back to empty", () => {
		render({
			messages: [],
			status: "streaming",
			config: { initial: ["Book a demo"], origins: ["flow"] },
		});

		const turnMessages: Msg[] = [
			userMessage("Which plan?"),
			assistantMessageWithFlowSuggestions(["Bronze", "Silver", "Gold"]),
		];
		render({
			messages: turnMessages,
			status: "ready",
			config: { initial: ["Book a demo"], origins: ["flow"] },
		});

		expect(hookRef.current?.suggestions).toEqual(["Bronze", "Silver", "Gold"]);
		expect(hookRef.current?.source).toBe("flow");

		render({
			messages: [],
			status: "ready",
			config: { initial: ["Book a demo"], origins: ["flow"] },
		});

		expect(hookRef.current?.suggestions).toEqual(["Book a demo"]);
		expect(hookRef.current?.source).toBe("channel");
	});
});

describe("useSuggestions — flow pills are opt-in", () => {
	test("renders no pills from a flow `_meta` entry when no config is passed", () => {
		render({ messages: [], status: "streaming" });

		const turnMessages: Msg[] = [
			userMessage("Which plan?"),
			assistantMessageWithFlowSuggestions(["Bronze", "Silver", "Gold"]),
		];
		render({ messages: turnMessages, status: "ready" });

		expect(hookRef.current?.suggestions).toEqual([]);
		expect(hookRef.current?.source).toBe("channel");
	});

	test("with only `initial` configured, followup pills render (default origins) while flow pills do not", () => {
		const config = { initial: ["Hi"] };
		render({ messages: [], status: "streaming", config });

		const followupTurn: Msg[] = [
			userMessage("Anything else?"),
			assistantMessageWithFollowupSuggestions(["From", "Followup"]),
		];
		render({ messages: followupTurn, status: "ready", config });

		expect(hookRef.current?.suggestions).toEqual(["From", "Followup"]);
		expect(hookRef.current?.source).toBe("followup");

		const secondUser: Msg = {
			id: "u2",
			role: "user",
			parts: [{ type: "text", text: "Which plan?" }],
		};
		render({
			messages: [...followupTurn, secondUser],
			status: "streaming",
			config,
		});

		const flowTurn: Msg[] = [
			...followupTurn,
			secondUser,
			assistantMessageWithFlowSuggestions(["Bronze", "Silver", "Gold"]),
		];
		render({ messages: flowTurn, status: "ready", config });

		expect(hookRef.current?.suggestions).toEqual([]);
		expect(hookRef.current?.source).toBe("channel");
	});
});

describe("useSuggestions — origin filtering", () => {
	test("filters out a followup result when only `flow` is enabled", () => {
		const config: { origins: SuggestionOrigin[] } = { origins: ["flow"] };
		render({ messages: [], status: "streaming", config });

		const turnMessages: Msg[] = [
			userMessage("Anything else?"),
			assistantMessageWithFollowupSuggestions(["From", "Followup"]),
		];
		render({ messages: turnMessages, status: "ready", config });

		expect(hookRef.current?.suggestions).toEqual([]);
		expect(hookRef.current?.source).toBe("channel");
	});

	test("filters out a flow result when only `followup` is enabled", () => {
		const config: { origins: SuggestionOrigin[] } = { origins: ["followup"] };
		render({ messages: [], status: "streaming", config });

		const turnMessages: Msg[] = [
			userMessage("Which plan?"),
			assistantMessageWithFlowSuggestions(["Bronze", "Silver", "Gold"]),
		];
		render({ messages: turnMessages, status: "ready", config });

		expect(hookRef.current?.suggestions).toEqual([]);
		expect(hookRef.current?.source).toBe("channel");
	});
});

describe("useSuggestions — full origin set (regression)", () => {
	const OPENER = ["Option A", "Option B", "Option C"];
	const NEXT_STEP = ["Choice X", "Choice Y"];
	const config = {
		initial: ["Starter 1", "Starter 2"],
		origins: ["channel", "page", "flow", "followup"] as SuggestionOrigin[],
	};

	function assistantWithTwoFlowResults(id: string) {
		const first = assistantMessageWithFlowSuggestions(OPENER);
		const second = assistantMessageWithFlowSuggestions(NEXT_STEP);
		return {
			id,
			role: "assistant" as const,
			parts: [...first.parts, ...second.parts],
		} as Msg;
	}

	test("starter prompts do not survive the first user message", () => {
		render({ messages: [], status: "ready", config });
		expect(hookRef.current?.suggestions).toEqual(["Starter 1", "Starter 2"]);
		const turn: Msg[] = [userMessage("hello")];
		render({ messages: turn, status: "streaming", config });
		expect(hookRef.current?.suggestions).toEqual([]);
	});

	test("flow pills win over starters when every origin is enabled", () => {
		render({ messages: [], status: "streaming", config });
		const turn: Msg[] = [
			userMessage("hello"),
			assistantMessageWithFlowSuggestions(OPENER),
		];
		render({ messages: turn, status: "ready", config });
		expect(hookRef.current?.suggestions).toEqual(OPENER);
		expect(hookRef.current?.source).toBe("flow");
	});

	test("the last flow result of the turn drives the pills", () => {
		render({ messages: [], status: "streaming", config });
		const turn: Msg[] = [
			userMessage("hello"),
			assistantWithTwoFlowResults("a1"),
		];
		render({ messages: turn, status: "ready", config });
		expect(hookRef.current?.suggestions).toEqual(NEXT_STEP);
	});

	test("an un-advanced start keeps its step's pills (residual the engine self-heal addresses)", () => {
		render({ messages: [], status: "streaming", config });
		const turn1: Msg[] = [
			userMessage("I just did the thing"),
			assistantMessageWithFlowSuggestions(OPENER),
		];
		render({ messages: turn1, status: "ready", config });
		expect(hookRef.current?.suggestions).toEqual(OPENER);
	});
});
