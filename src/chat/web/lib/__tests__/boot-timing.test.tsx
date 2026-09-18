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

const { __resetBootTiming, markBoot, markConfigSource, reportBoot } =
	await import("../timing");
const { useBootTiming } = await import("../timing-context");

interface Captured {
	url: string;
	init: RequestInit;
}

const calls: Captured[] = [];
let realFetch: typeof globalThis.fetch;

beforeEach(() => {
	__resetBootTiming();
	calls.length = 0;
	realFetch = globalThis.fetch;
	// biome-ignore lint/suspicious/noExplicitAny: test stub
	(globalThis as any).fetch = async (url: any, init: any) => {
		calls.push({ url: String(url), init });
		return new Response(null, { status: 404 });
	};
});

afterEach(() => {
	globalThis.fetch = realFetch;
});

const target = {
	api: "https://app.waniwani.ai/api/mcp/chat",
	token: "wwp_test",
	channelId: "chan_1",
};

describe("reportBoot", () => {
	test("carries the collected marks plus the surface and config tags", () => {
		markBoot("configStart", 30);
		markBoot("configEnd", 90);
		markConfigSource("cache");
		markConfigSource("remote");

		reportBoot({ ...target, mode: "floating" });

		expect(calls).toHaveLength(1);
		const payload = JSON.parse(String(calls[0].init.body));
		expect(payload.kind).toBe("boot");
		expect(payload.metrics.configStart).toBe(30);
		expect(payload.metrics.configEnd).toBe(90);
		expect(payload.metrics.bundleExecuted).toBeGreaterThanOrEqual(0);
		expect(payload.tags.mode).toBe("floating");
		expect(payload.tags.configSource).toBe("cache");
		expect(payload.tags.secondSdk).toBe(false);
	});
});

describe("useBootTiming", () => {
	let container: HTMLElement;
	let root: Root;

	beforeEach(() => {
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => root.unmount());
		container.remove();
	});

	function Probe({ painted }: { painted: boolean }) {
		useBootTiming({
			...target,
			mode: "inline",
			paintMark: "chatVisible",
			painted,
		});
		return null;
	}

	test("stays quiet until the surface has painted, then reports once", async () => {
		act(() => {
			root.render(createElement(Probe, { painted: false }));
		});
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 600));
		});
		expect(calls).toHaveLength(0);

		act(() => {
			root.render(createElement(Probe, { painted: true }));
		});
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 600));
		});
		expect(calls).toHaveLength(1);
		const payload = JSON.parse(String(calls[0].init.body));
		expect(payload.metrics.chatVisible).toBeGreaterThanOrEqual(0);

		act(() => {
			root.render(createElement(Probe, { painted: true }));
		});
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 600));
		});
		expect(calls).toHaveLength(1);
	});
});
