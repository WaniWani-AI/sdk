import { afterEach, describe, expect, mock, test } from "bun:test";
import { GlobalWindow } from "happy-dom";

import { applyIframePatches } from "../initialize-next-in-iframe";

const IFRAME_ORIGIN = "http://iframe-host:3000";
const APP_ORIGIN = "http://app-host:3001";
const WANIWANI_ORIGIN = "http://api-host:3000";

let win: InstanceType<typeof GlobalWindow>;
let originalFetch: ReturnType<typeof mock>;

function setup(passthroughOrigins: string[] = []) {
	win = new GlobalWindow({ url: `${IFRAME_ORIGIN}/widget` });
	globalThis.window = win as unknown as typeof globalThis.window;
	globalThis.document = win.document as unknown as typeof globalThis.document;
	globalThis.history = win.history as unknown as typeof globalThis.history;
	globalThis.MutationObserver =
		win.MutationObserver as unknown as typeof globalThis.MutationObserver;

	// Force `window.self !== window.top` so the patch installs the fetch wrapper.
	Object.defineProperty(win, "top", { value: {}, writable: true });

	(win as unknown as { innerBaseUrl: string }).innerBaseUrl = APP_ORIGIN;
	(
		win as unknown as { __wwPassthroughOrigins: string[] }
	).__wwPassthroughOrigins = passthroughOrigins;

	originalFetch = mock(() =>
		Promise.resolve(new Response("{}", { status: 200 })),
	);
	(win as unknown as { fetch: typeof fetch }).fetch =
		originalFetch as unknown as typeof fetch;

	applyIframePatches();
}

afterEach(() => {
	originalFetch.mockClear();
	win.close();
});

describe("applyIframePatches fetch wrapper", () => {
	test("rewrites relative URL to baseUrl", async () => {
		setup();

		await win.fetch("/api/upload");

		expect(originalFetch).toHaveBeenCalledTimes(1);
		const [url, init] = originalFetch.mock.calls[0];
		expect(url).toBe(`${APP_ORIGIN}/api/upload`);
		expect((init as RequestInit | undefined)?.mode).toBe("cors");
	});

	test("does NOT rewrite absolute URL pointing at iframe origin (the key fix)", async () => {
		setup();

		const target = `${IFRAME_ORIGIN}/api/mcp/events/v2/batch`;
		await win.fetch(target);

		expect(originalFetch).toHaveBeenCalledTimes(1);
		const [url] = originalFetch.mock.calls[0];
		expect(url).toBe(target);
	});

	test("does NOT rewrite absolute URL to a third-party origin", async () => {
		setup();

		const target = `${WANIWANI_ORIGIN}/api/mcp/events/v2/batch`;
		await win.fetch(target);

		expect(originalFetch).toHaveBeenCalledTimes(1);
		const [url] = originalFetch.mock.calls[0];
		expect(url).toBe(target);
	});

	test("absolute URL matching appOrigin gets mode:cors but URL unchanged", async () => {
		setup();

		const target = `${APP_ORIGIN}/api/something`;
		await win.fetch(target);

		expect(originalFetch).toHaveBeenCalledTimes(1);
		const [url, init] = originalFetch.mock.calls[0];
		expect(url).toBe(target);
		expect((init as RequestInit | undefined)?.mode).toBe("cors");
	});

	test("URL instance is never rewritten, even for same-origin path", async () => {
		setup();

		const target = new URL("/api/upload", IFRAME_ORIGIN);
		await win.fetch(target);

		expect(originalFetch).toHaveBeenCalledTimes(1);
		const [url] = originalFetch.mock.calls[0];
		expect(String(url)).toBe(target.toString());
	});

	test("protocol-relative URL is treated as absolute", async () => {
		setup();

		const target = "//api-host:3000/track";
		await win.fetch(target);

		expect(originalFetch).toHaveBeenCalledTimes(1);
		const [url] = originalFetch.mock.calls[0];
		expect(url).toBe(target);
	});

	test("relative URL whose origin is in passthroughOrigins skips rewrite", async () => {
		setup([IFRAME_ORIGIN]);

		await win.fetch("/api/upload");

		expect(originalFetch).toHaveBeenCalledTimes(1);
		const [url, init] = originalFetch.mock.calls[0];
		expect(url).toBe("/api/upload");
		expect((init as RequestInit | undefined)?.mode).toBeUndefined();
	});

	test("relative URL with query and hash is preserved when rewritten", async () => {
		setup();

		await win.fetch("/api/items?page=2#top");

		expect(originalFetch).toHaveBeenCalledTimes(1);
		const [url] = originalFetch.mock.calls[0];
		expect(url).toBe(`${APP_ORIGIN}/api/items?page=2#top`);
	});
});
