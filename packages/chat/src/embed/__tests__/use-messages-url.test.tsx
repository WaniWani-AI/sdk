import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	spyOn,
	test,
} from "bun:test";
import { Window } from "happy-dom";

const win = new Window({ url: "https://shop.example.com/pricing" });
for (const key of [
	"document",
	"navigator",
	"HTMLElement",
	"HTMLDivElement",
	"Element",
	"Node",
	"Text",
	"Comment",
	"DocumentFragment",
	"Event",
	"CustomEvent",
	"MutationObserver",
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

const { useMessagesUrl } = await import("../use-messages-url");
const { READINESS_TIMEOUT_MS } = await import("../remote-config");

type HookResult = ReturnType<typeof useMessagesUrl>;

const URL_MESSAGES = "https://shop.example.com/messages.json";
const realFetch = globalThis.fetch;
const warn = spyOn(console, "warn").mockImplementation(() => {});

let root: Root | null = null;
let container: HTMLElement | null = null;
let calls: { url: string; init: RequestInit | undefined }[] = [];

function stubFetch(
	respond: (url: string, init: RequestInit | undefined) => Promise<Response>,
) {
	// biome-ignore lint/suspicious/noExplicitAny: test stub
	(globalThis as any).fetch = (url: any, init: any) => {
		calls.push({ url: String(url), init });
		return respond(String(url), init);
	};
}

function mountHook(url: string | undefined): { latest: () => HookResult } {
	let latest: HookResult = { messages: undefined, ready: false };
	function Probe() {
		latest = useMessagesUrl(url);
		return null;
	}
	const el = document.createElement("div");
	container = el;
	document.body.appendChild(el);
	act(() => {
		root = createRoot(el);
		root.render(createElement(Probe));
	});
	return { latest: () => latest };
}

async function waitFor(predicate: () => boolean, timeout = 2000) {
	const deadline = Date.now() + timeout;
	while (!predicate()) {
		if (Date.now() > deadline) {
			throw new Error("waitFor timed out");
		}
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 5));
		});
	}
}

beforeEach(() => {
	calls = [];
	warn.mockClear();
});

afterEach(() => {
	act(() => {
		root?.unmount();
	});
	root = null;
	container?.remove();
	container = null;
	globalThis.fetch = realFetch;
});

afterAll(() => {
	warn.mockRestore();
});

describe("useMessagesUrl", () => {
	test("no url is ready at once and fetches nothing", () => {
		stubFetch(async () => Response.json({}));
		const { latest } = mountHook(undefined);
		expect(latest()).toEqual({ messages: undefined, ready: true });
		expect(calls).toHaveLength(0);
	});

	test("resolves messages from a json url", async () => {
		const body = { fr: { workingIndicator: { default: "Un instant…" } } };
		stubFetch(async () => Response.json(body));
		const { latest } = mountHook(URL_MESSAGES);
		expect(latest().ready).toBe(false);
		await waitFor(() => latest().ready);
		expect(latest().messages).toEqual(body);
		expect(calls).toHaveLength(1);
		expect(calls[0]?.url).toBe(URL_MESSAGES);
		expect(new Headers(calls[0]?.init?.headers).get("Accept")).toBe(
			"application/json",
		);
		expect(calls[0]?.init?.credentials).toBe("omit");
		expect(warn).not.toHaveBeenCalled();
	});

	test("messages url failure resolves ready after timeout", async () => {
		stubFetch(async () => {
			throw new TypeError("Failed to fetch");
		});
		const { latest } = mountHook(URL_MESSAGES);
		await waitFor(() => latest().ready, READINESS_TIMEOUT_MS + 500);
		expect(latest().messages).toBeUndefined();
		expect(warn).toHaveBeenCalledTimes(1);
	});

	test("a non-ok response or a non-object body resolves ready with nothing", async () => {
		stubFetch(async () => new Response("nope", { status: 404 }));
		const first = mountHook(URL_MESSAGES);
		await waitFor(() => first.latest().ready);
		expect(first.latest().messages).toBeUndefined();
		act(() => {
			root?.unmount();
		});

		stubFetch(async () => Response.json(["not", "a", "map"]));
		const second = mountHook(URL_MESSAGES);
		await waitFor(() => second.latest().ready);
		expect(second.latest().messages).toBeUndefined();
	});

	test("a stalled url resolves ready after the readiness timeout", async () => {
		stubFetch(
			(_url, init) =>
				new Promise((_resolve, reject) => {
					init?.signal?.addEventListener("abort", () =>
						reject(new DOMException("aborted", "AbortError")),
					);
				}),
		);
		const started = Date.now();
		const { latest } = mountHook(URL_MESSAGES);
		expect(latest().ready).toBe(false);
		await waitFor(() => latest().ready, READINESS_TIMEOUT_MS + 1000);
		expect(Date.now() - started).toBeGreaterThanOrEqual(
			READINESS_TIMEOUT_MS - 50,
		);
		expect(latest().messages).toBeUndefined();
	});

	test("unmounting aborts the request", async () => {
		let signal: AbortSignal | undefined;
		stubFetch((_url, init) => {
			signal = init?.signal ?? undefined;
			return new Promise(() => {});
		});
		mountHook(URL_MESSAGES);
		expect(signal?.aborted).toBe(false);
		act(() => {
			root?.unmount();
		});
		root = null;
		expect(signal?.aborted).toBe(true);
	});
});
