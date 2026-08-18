import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";

// ---------------------------------------------------------------------------
// Set up DOM globals before importing React
// ---------------------------------------------------------------------------

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

const { __resetPageViewGuard } = await import("../../lib/page-view");
const { resolveConfig } = await import("../config");
type EmbedConfigType = import("../config").EmbedConfig;
const { fetchRemoteConfig, useRemoteEmbedConfig } = await import(
	"../remote-config"
);

// ---------------------------------------------------------------------------
// Fetch stub — serves `GET {api}/config` and captures the V2 batch ingest POST
// ---------------------------------------------------------------------------

interface BatchEvent {
	name: string;
	source?: string;
	properties: Record<string, unknown>;
}

function stubFetch(configBody: Record<string, unknown>): {
	batches: BatchEvent[][];
	restore: () => void;
} {
	const batches: BatchEvent[][] = [];
	const real = globalThis.fetch;
	// biome-ignore lint/suspicious/noExplicitAny: test stub
	(globalThis as any).fetch = async (url: any, init: any) => {
		const href = String(url);
		if (href.includes("/config")) {
			return Response.json(configBody);
		}
		if (href.includes("/events/v2/batch")) {
			const parsed = JSON.parse(String(init?.body));
			batches.push(parsed.events);
			return new Response(null, { status: 202 });
		}
		throw new Error(`unexpected fetch: ${href}`);
	};
	return {
		batches,
		restore: () => {
			globalThis.fetch = real;
		},
	};
}

async function waitFor(predicate: () => boolean): Promise<void> {
	const deadline = Date.now() + 2000;
	while (!predicate()) {
		if (Date.now() > deadline) {
			throw new Error("waitFor timed out");
		}
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 5));
		});
	}
}

// ---------------------------------------------------------------------------
// Harness — mounts the hook and reports the latest resolved config
// ---------------------------------------------------------------------------

let root: Root | null = null;
let container: HTMLElement | null = null;

function mountHook(programmatic: Partial<EmbedConfigType>): {
	latest: () => EmbedConfigType;
} {
	const initial = resolveConfig(programmatic, undefined, {});
	let latest = initial;
	function Probe() {
		const { config } = useRemoteEmbedConfig(initial, programmatic, {});
		latest = config;
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

beforeEach(() => {
	__resetPageViewGuard();
	win.sessionStorage.clear();
	win.localStorage.clear();
});

afterEach(() => {
	act(() => {
		root?.unmount();
	});
	root = null;
	container?.remove();
	container = null;
});

const API = "https://app.waniwani.ai/api/mcp/chat";

// ---------------------------------------------------------------------------
// fetchRemoteConfig — /config → Partial<EmbedConfig> mapping
// ---------------------------------------------------------------------------

describe("fetchRemoteConfig — channelId mapping", () => {
	test("maps a server-supplied channelId into the config partial", async () => {
		const { restore } = stubFetch({
			success: true,
			data: {
				welcomeMessage: null,
				title: null,
				placeholder: null,
				suggestions: null,
				source: "acme-web",
				channelId: "chan_srv",
			},
		});
		try {
			const partial = await fetchRemoteConfig(API, "wwp_test");
			expect(partial.channelId).toBe("chan_srv");
			expect(partial.source).toBe("acme-web");
		} finally {
			restore();
		}
	});

	test("omits channelId when the server does not send one", async () => {
		const { restore } = stubFetch({
			success: true,
			data: {
				welcomeMessage: "Hi",
				title: null,
				placeholder: null,
				suggestions: null,
			},
		});
		try {
			const partial = await fetchRemoteConfig(API, "wwp_test");
			expect("channelId" in partial).toBe(false);
			expect(partial.welcomeMessage).toBe("Hi");
		} finally {
			restore();
		}
	});
});

// ---------------------------------------------------------------------------
// useRemoteEmbedConfig — page.viewed channel attribution
// ---------------------------------------------------------------------------

describe("useRemoteEmbedConfig — page.viewed channel attribution", () => {
	test("token-only embed: page.viewed carries the /config-resolved channelId", async () => {
		const { batches, restore } = stubFetch({
			success: true,
			data: {
				welcomeMessage: null,
				title: null,
				placeholder: null,
				suggestions: null,
				source: "acme-web",
				channelId: "chan_srv",
			},
		});
		try {
			const { latest } = mountHook({ token: "wwp_test" });
			await waitFor(() => batches.length > 0);
			const [ev] = batches[0];
			expect(ev.name).toBe("page.viewed");
			expect(ev.properties.channelId).toBe("chan_srv");
			expect(ev.source).toBe("acme-web");
			// The resolved config picks the server channel up too, so chat
			// requests and manual track events attribute the same way.
			expect(latest().channelId).toBe("chan_srv");
		} finally {
			restore();
		}
	});

	test("host-supplied channelId wins over the /config one", async () => {
		const { batches, restore } = stubFetch({
			success: true,
			data: {
				welcomeMessage: null,
				title: null,
				placeholder: null,
				suggestions: null,
				channelId: "chan_srv",
			},
		});
		try {
			const { latest } = mountHook({
				token: "wwp_test",
				channelId: "chan_host",
			});
			await waitFor(() => batches.length > 0);
			const [ev] = batches[0];
			expect(ev.name).toBe("page.viewed");
			expect(ev.properties.channelId).toBe("chan_host");
			expect(latest().channelId).toBe("chan_host");
		} finally {
			restore();
		}
	});

	test("no channelId anywhere: page.viewed still fires via the source tag alone", async () => {
		const { batches, restore } = stubFetch({
			success: true,
			data: {
				welcomeMessage: null,
				title: null,
				placeholder: null,
				suggestions: null,
				source: "acme-web",
			},
		});
		try {
			const { latest } = mountHook({ token: "wwp_test" });
			await waitFor(() => batches.length > 0);
			const [ev] = batches[0];
			expect(ev.name).toBe("page.viewed");
			expect(ev.properties.channelId).toBeUndefined();
			expect(latest().channelId).toBeUndefined();
		} finally {
			restore();
		}
	});

	test("token-only embed against a /config with neither channelId nor source: send is skipped", async () => {
		const { batches, restore } = stubFetch({
			success: true,
			data: {
				welcomeMessage: "Hi",
				title: null,
				placeholder: null,
				suggestions: null,
			},
		});
		try {
			const { latest } = mountHook({ token: "wwp_test" });
			// Wait until the remote config has been applied, then give the
			// (would-be) page-view send a few ticks to prove it never happens.
			await waitFor(() => latest().welcomeMessage === "Hi");
			await act(async () => {
				await new Promise((resolve) => setTimeout(resolve, 25));
			});
			expect(batches).toHaveLength(0);
		} finally {
			restore();
		}
	});
});
