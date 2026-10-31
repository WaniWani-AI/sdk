import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { Window } from "happy-dom";

// biome-ignore lint/suspicious/noExplicitAny: test setup
(globalThis as any).indexedDB = new IDBFactory();
// biome-ignore lint/suspicious/noExplicitAny: test setup
(globalThis as any).IDBKeyRange = IDBKeyRange;

const win = new Window({ url: "https://host.example" });
for (const key of [
	"document",
	"navigator",
	"HTMLElement",
	"HTMLDivElement",
	"HTMLAnchorElement",
	"HTMLButtonElement",
	"HTMLInputElement",
	"HTMLTextAreaElement",
	"HTMLFormElement",
	"MutationObserver",
	"IntersectionObserver",
	"customElements",
	"Element",
	"Node",
	"Text",
	"Comment",
	"DocumentFragment",
	"Event",
	"CustomEvent",
	"MouseEvent",
	"KeyboardEvent",
	"FormData",
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
// biome-ignore lint/suspicious/noExplicitAny: happy-dom has no object-URL store
(URL as any).createObjectURL = () => "blob:https://host.example/1";
// biome-ignore lint/suspicious/noExplicitAny: happy-dom has no object-URL store
(URL as any).revokeObjectURL = () => {};

const { act, createElement } = await import("react");
const { createRoot } = await import("react-dom/client");
type Root = ReturnType<typeof createRoot>;

let chatStatus = "ready";

// @ts-expect-error -- bun:test `mock.module` exists at runtime but has no TS type
mock.module("@ai-sdk/react", () => ({
	useChat() {
		return {
			messages: [],
			sendMessage: mock(() => {}),
			setMessages: mock(() => {}),
			status: chatStatus,
		};
	},
}));

interface TransportOptions {
	api: string;
	headers: () => Record<string, string>;
	fetch: typeof fetch;
}

let transportOptions: TransportOptions | null = null;

// `mock.module` is process-global in bun:test, and the sibling attachments file
// stubs this same module. Registering our own capture here keeps the chat leg
// observable whichever file loads first.
// @ts-expect-error -- bun:test `mock.module` exists at runtime but has no TS type
mock.module("../../lib/lenient-chat-transport", () => ({
	LenientChatTransport: class {
		constructor(options: TransportOptions) {
			transportOptions = options;
		}
	},
}));

/** Puts a chat POST on the wire through the credential thunk the engine built. */
async function sendChatRequest() {
	if (!transportOptions) {
		throw new Error("the engine never built a chat transport");
	}
	await transportOptions
		.fetch(transportOptions.api, {
			method: "POST",
			headers: transportOptions.headers(),
		})
		.catch(() => {
			// The response body is not what this file is about.
		});
}

interface Call {
	url: string;
	method: string;
	headers: Record<string, string>;
}

let calls: Call[] = [];
let minted = 0;
let mintFails = false;

interface ProgressEventLike {
	lengthComputable: boolean;
	loaded: number;
	total: number;
}

/** The storage PUT: succeeds on its own so an upload reaches a document id. */
class FakeXhr {
	status = 0;
	readonly upload: { onprogress?: (event: ProgressEventLike) => void } = {};
	timeout = 0;
	onload: (() => void) | null = null;
	onerror: (() => void) | null = null;
	onabort: (() => void) | null = null;
	ontimeout: (() => void) | null = null;

	open() {}
	setRequestHeader() {}
	abort() {
		this.onabort?.();
	}
	send() {
		setTimeout(() => {
			this.status = 200;
			this.onload?.();
		}, 0);
	}
}

const originalFetch = globalThis.fetch;
// biome-ignore lint/suspicious/noExplicitAny: swapping the browser global for a stub
const originalXhr = (globalThis as any).XMLHttpRequest;

beforeEach(() => {
	calls = [];
	minted = 0;
	mintFails = false;
	chatStatus = "ready";
	transportOptions = null;
	// biome-ignore lint/suspicious/noExplicitAny: swapping the browser global for a stub
	(globalThis as any).XMLHttpRequest = FakeXhr;

	globalThis.fetch = mock(async (input: unknown, sent: unknown) => {
		const init = sent as RequestInit | undefined;
		const url = String(input);
		const headers: Record<string, string> = {};
		new Headers(init?.headers ?? {}).forEach((value, key) => {
			headers[key] = value;
		});
		calls.push({ url, method: init?.method ?? "GET", headers });

		if (url.includes("/upload-url")) {
			if (mintFails) {
				throw new TypeError("Failed to fetch");
			}
			minted += 1;
			return Response.json({
				success: true,
				data: {
					documentId: `doc_${minted}`,
					uploadUrl: `https://storage.test/put/doc_${minted}`,
					headers: {},
				},
			});
		}
		if (url.endsWith("/tools")) {
			return Response.json({ tools: [] });
		}
		if (init?.method === "DELETE") {
			return new Response(null, { status: 204 });
		}
		return new Response(null, { status: 200 });
	}) as unknown as typeof fetch;
});

afterEach(() => {
	globalThis.fetch = originalFetch;
	// biome-ignore lint/suspicious/noExplicitAny: swapping the browser global for a stub
	(globalThis as any).XMLHttpRequest = originalXhr;
});

const { ChatEmbed } = await import("../chat-embed");
const { uploadDocument, DocumentUploadError } = await import(
	"../../lib/document-upload"
);

const API = "https://app.waniwani.ai/api/mcp/chat";
const TOOLS_URL = `${API}/tools`;
const MINT_URL = "https://app.waniwani.ai/api/mcp/modules/documents/upload-url";
const DISCARD_URL = "https://app.waniwani.ai/api/mcp/modules/documents/doc_1";

const DOCUMENT_UPLOAD = {
	enabled: true,
	maxBytes: 20 * 1024 * 1024,
	maxPdfPages: 30,
	maxFiles: 10,
	accept: ["application/pdf", "image/png"],
};

/** Each leg owns a marker header the other never sets. */
const CHAT_ONLY = {
	Authorization: "Bearer chat_credential",
	"X-Chat-Only": "yes",
};
const UPLOAD_ONLY = {
	Authorization: "Bearer wwp_upload",
	"X-Upload-Only": "yes",
};

const CHAT_CREDENTIAL = {
	authorization: "Bearer chat_credential",
	"x-chat-only": "yes",
};
/** `uploadHeaders` wins on `authorization`; both markers ride along. */
const MERGED_CREDENTIAL = {
	authorization: "Bearer wwp_upload",
	"x-chat-only": "yes",
	"x-upload-only": "yes",
};

let root: Root | null = null;
let container: HTMLElement | null = null;

type EmbedProps = Parameters<typeof ChatEmbed>[0];

function settle(ms = 25) {
	return act(async () => {
		await new Promise((resolve) => setTimeout(resolve, ms));
	});
}

async function renderEmbed(overrides: Partial<EmbedProps> = {}) {
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	await rerenderEmbed(overrides);
}

async function rerenderEmbed(overrides: Partial<EmbedProps> = {}) {
	await act(async () => {
		root?.render(
			createElement(ChatEmbed, {
				api: API,
				documentUpload: DOCUMENT_UPLOAD,
				...overrides,
			} as EmbedProps),
		);
	});
	await settle();
}

function unmountEmbed() {
	if (root) {
		act(() => {
			root?.unmount();
		});
		root = null;
	}
	container?.remove();
	container = null;
}

afterEach(unmountEmbed);

function attachPdf(name = "policy.pdf") {
	const textarea = document.querySelector("textarea");
	if (!textarea) {
		throw new Error("no textarea rendered");
	}
	act(() => {
		const event = new win.Event("paste", { bubbles: true, cancelable: true });
		// biome-ignore lint/suspicious/noExplicitAny: happy-dom has no ClipboardEvent with items
		(event as any).clipboardData = {
			items: [
				{
					kind: "file",
					getAsFile: () => new File(["xx"], name, { type: "application/pdf" }),
				},
			],
		};
		textarea.dispatchEvent(event as unknown as Event);
	});
}

function click(selector: string) {
	const button = document.querySelector(selector);
	if (!button) {
		throw new Error(`no element matched ${selector}`);
	}
	act(() => {
		button.dispatchEvent(
			new win.MouseEvent("click", {
				bubbles: true,
				cancelable: true,
			}) as unknown as Event,
		);
	});
}

async function submitComposer() {
	const form = document.querySelector("form");
	if (!form) {
		throw new Error("no form rendered");
	}
	await act(async () => {
		form.dispatchEvent(
			new win.Event("submit", {
				bubbles: true,
				cancelable: true,
			}) as unknown as Event,
		);
	});
	await settle();
}

function callsTo(url: string, method?: string): Call[] {
	return calls.filter(
		(call) => call.url === url && (!method || call.method === method),
	);
}

function only(url: string, method?: string): Call {
	const found = callsTo(url, method);
	if (found.length !== 1) {
		throw new Error(
			`expected exactly one ${method ?? "any"} ${url}, saw ${found.length} among ${calls
				.map((c) => `${c.method} ${c.url}`)
				.join(" | ")}`,
		);
	}
	return found[0] as Call;
}

/**
 * What a recorded request spent: every header but the payload's own content
 * type. `Headers` collapses names case-insensitively, so a two-key object that
 * fetch would have joined shows up here as one lowercase name holding
 * `"a, b"` — which is what makes an exact match on this map a proof that the
 * override replaced rather than piled on.
 */
function credential(call: Call): Record<string, string> {
	const spent: Record<string, string> = {};
	for (const [key, value] of Object.entries(call.headers)) {
		if (key !== "content-type") {
			spent[key] = value;
		}
	}
	return spent;
}

function requestsBearing(marker: string): string[] {
	return calls
		.filter((call) => marker in call.headers)
		.map((call) => `${call.method} ${call.url}`);
}

/** Mounts, attaches, takes the attachment back, and reports what both document calls spent. */
async function documentLeg(overrides: Partial<EmbedProps> = {}) {
	calls = [];
	minted = 0;
	await renderEmbed(overrides);

	attachPdf();
	await settle();
	click('button[aria-label="Remove attachment"]');
	await settle();

	const mint = only(MINT_URL, "POST");
	const spent = {
		mint: credential(mint),
		mintContentType: mint.headers["content-type"],
		discard: credential(only(DISCARD_URL, "DELETE")),
	};
	unmountEmbed();
	return spent;
}

describe("ChatEmbed — uploadHeaders merges over headers on the document leg", () => {
	test("the mint POST keeps the chat headers and takes the upload override", async () => {
		await renderEmbed({ headers: CHAT_ONLY, uploadHeaders: UPLOAD_ONLY });

		attachPdf();
		await settle();

		expect(credential(only(MINT_URL, "POST"))).toEqual(MERGED_CREDENTIAL);
	});

	test("taking the attachment back deletes it with the same merged credential", async () => {
		await renderEmbed({ headers: CHAT_ONLY, uploadHeaders: UPLOAD_ONLY });

		attachPdf();
		await settle();
		click('button[aria-label="Remove attachment"]');
		await settle();

		expect(credential(only(DISCARD_URL, "DELETE"))).toEqual(MERGED_CREDENTIAL);
	});

	test("a header only headers sets survives the override on both document calls", async () => {
		const spent = await documentLeg({
			headers: {
				Authorization: "Bearer chat_credential",
				"X-Tenant-Id": "acme",
			},
			uploadHeaders: { Authorization: "Bearer wwp_upload" },
		});

		expect(spent.mint).toEqual({
			authorization: "Bearer wwp_upload",
			"x-tenant-id": "acme",
		});
		expect(spent.discard).toEqual(spent.mint);
	});

	test("without uploadHeaders both document calls spend the chat credential", async () => {
		const spent = await documentLeg({ headers: CHAT_ONLY });

		expect(spent.mint).toEqual(CHAT_CREDENTIAL);
		expect(spent.discard).toEqual(CHAT_CREDENTIAL);
	});

	test("an empty uploadHeaders is indistinguishable from leaving it unset", async () => {
		const empty = await documentLeg({ headers: CHAT_ONLY, uploadHeaders: {} });
		const unset = await documentLeg({ headers: CHAT_ONLY });

		expect(empty).toEqual(unset);
		expect(empty.mint).toEqual(CHAT_CREDENTIAL);
		expect(empty.discard).toEqual(CHAT_CREDENTIAL);
	});

	test("uploadHeaders alone still authenticates the document leg", async () => {
		const spent = await documentLeg({ uploadHeaders: UPLOAD_ONLY });

		expect(spent.mint).toEqual({
			authorization: "Bearer wwp_upload",
			"x-upload-only": "yes",
		});
		expect(spent.discard).toEqual(spent.mint);
	});

	test("neither record set: the upload is still attempted and the chip survives it", async () => {
		await renderEmbed();

		attachPdf();
		await settle();

		const mint = only(MINT_URL, "POST");
		expect(credential(mint)).toEqual({});
		expect(mint.headers["content-type"]).toBe("application/json");
		expect(
			document.querySelectorAll('button[aria-label="Remove attachment"]')
				.length,
		).toBe(1);
	});

	test("an override valued empty still replaces the chat header", async () => {
		const spent = await documentLeg({
			headers: { Authorization: "Bearer chat_credential" },
			uploadHeaders: { Authorization: "" },
		});

		expect(spent.mint).toEqual({ authorization: "" });
		expect(spent.discard).toEqual({ authorization: "" });
	});

	test("a rotated uploadHeaders is what the next upload spends", async () => {
		await renderEmbed({ headers: CHAT_ONLY, uploadHeaders: UPLOAD_ONLY });

		attachPdf("first.pdf");
		await settle();

		await rerenderEmbed({
			headers: CHAT_ONLY,
			uploadHeaders: { Authorization: "Bearer wwp_rotated" },
		});

		attachPdf("second.pdf");
		await settle();

		const mints = callsTo(MINT_URL, "POST");
		expect(mints.map((call) => call.headers.authorization)).toEqual([
			"Bearer wwp_upload",
			"Bearer wwp_rotated",
		]);
		expect(mints.map((call) => call.headers["x-chat-only"])).toEqual([
			"yes",
			"yes",
		]);
	});

	test("dropping uploadHeaders between renders hands the document leg back to headers", async () => {
		await renderEmbed({ headers: CHAT_ONLY, uploadHeaders: UPLOAD_ONLY });

		attachPdf("first.pdf");
		await settle();

		await rerenderEmbed({ headers: CHAT_ONLY, uploadHeaders: {} });

		attachPdf("second.pdf");
		await settle();

		expect(callsTo(MINT_URL, "POST").map((call) => credential(call))).toEqual([
			MERGED_CREDENTIAL,
			CHAT_CREDENTIAL,
		]);
	});
});

describe("ChatEmbed — a case-different override replaces instead of piling on", () => {
	test("an uppercase override wipes the lowercase authorization rather than joining it", async () => {
		const spent = await documentLeg({
			headers: { authorization: "Bearer chat" },
			uploadHeaders: { Authorization: "Bearer upload" },
		});

		expect(spent.mint).toEqual({ authorization: "Bearer upload" });
		expect(spent.discard).toEqual({ authorization: "Bearer upload" });
		expect(spent.mint.authorization).not.toContain("Bearer chat");
	});

	test("a lowercase override wipes the uppercase authorization the same way", async () => {
		const spent = await documentLeg({
			headers: { Authorization: "Bearer chat" },
			uploadHeaders: { authorization: "Bearer upload" },
		});

		expect(spent.mint).toEqual({ authorization: "Bearer upload" });
		expect(spent.discard).toEqual({ authorization: "Bearer upload" });
		expect(spent.mint.authorization).not.toContain("Bearer chat");
	});

	test("a custom header overridden under different casing keeps a single value", async () => {
		const spent = await documentLeg({
			headers: { "X-Foo": "from-chat", Authorization: "Bearer chat" },
			uploadHeaders: { "x-foo": "from-upload", authorization: "Bearer upload" },
		});

		expect(spent.mint).toEqual({
			"x-foo": "from-upload",
			authorization: "Bearer upload",
		});
		expect(spent.discard).toEqual(spent.mint);
		expect(Object.values(spent.mint).join(" | ")).not.toContain("from-chat");
	});

	test("the chat leg keeps the value the host gave it, override or not", async () => {
		await renderEmbed({
			headers: { authorization: "Bearer chat" },
			uploadHeaders: { Authorization: "Bearer upload" },
		});

		attachPdf();
		await settle();
		await sendChatRequest();

		expect(credential(only(TOOLS_URL, "GET"))).toEqual({
			authorization: "Bearer chat",
		});
		expect(credential(only(API, "POST"))).toEqual({
			authorization: "Bearer chat",
		});
	});
});

describe("ChatEmbed — the mint keeps its own content type", () => {
	test("a lowercase content-type from the host does not join the mint's own", async () => {
		const spent = await documentLeg({
			headers: {
				"content-type": "text/plain",
				Authorization: "Bearer chat_credential",
			},
		});

		expect(spent.mintContentType).toBe("application/json");
	});

	test("an uppercase Content-Type from the host is replaced too", async () => {
		const spent = await documentLeg({
			headers: { "Content-Type": "text/plain" },
		});

		expect(spent.mintContentType).toBe("application/json");
	});

	test("uploadHeaders cannot claim the mint's content type either", async () => {
		const spent = await documentLeg({
			headers: { "Content-Type": "text/plain" },
			uploadHeaders: { "content-type": "application/xml" },
		});

		expect(spent.mintContentType).toBe("application/json");
	});

	test("only the mint forces JSON: the discard DELETE carries what the host set", async () => {
		calls = [];
		minted = 0;
		await renderEmbed({ headers: { "content-type": "text/plain" } });

		attachPdf();
		await settle();
		click('button[aria-label="Remove attachment"]');
		await settle();

		expect(only(DISCARD_URL, "DELETE").headers["content-type"]).toBe(
			"text/plain",
		);
	});
});

describe("ChatEmbed — the chat leg and the document leg stay apart", () => {
	test("the chat request carries headers and never the upload override", async () => {
		await renderEmbed({ headers: CHAT_ONLY, uploadHeaders: UPLOAD_ONLY });

		attachPdf();
		await settle();
		await sendChatRequest();

		expect(credential(only(API, "POST"))).toEqual(CHAT_CREDENTIAL);
		expect(credential(only(MINT_URL, "POST"))).toEqual(MERGED_CREDENTIAL);
	});

	test("the tool catalog is a chat-credential request, not a merged one", async () => {
		await renderEmbed({ headers: CHAT_ONLY, uploadHeaders: UPLOAD_ONLY });

		expect(credential(only(TOOLS_URL, "GET"))).toEqual(CHAT_CREDENTIAL);
	});

	test("the upload marker reaches the document calls and nothing else", async () => {
		await renderEmbed({ headers: CHAT_ONLY, uploadHeaders: UPLOAD_ONLY });

		attachPdf();
		await settle();
		await sendChatRequest();
		click('button[aria-label="Remove attachment"]');
		await settle();

		expect(requestsBearing("x-upload-only")).toEqual([
			`POST ${MINT_URL}`,
			`DELETE ${DISCARD_URL}`,
		]);
		expect(requestsBearing("x-chat-only")).toEqual([
			`GET ${TOOLS_URL}`,
			`POST ${MINT_URL}`,
			`POST ${API}`,
			`DELETE ${DISCARD_URL}`,
		]);
	});

	test("a chat sending no headers still signs the upload", async () => {
		await renderEmbed({ uploadHeaders: UPLOAD_ONLY });

		attachPdf();
		await settle();
		await sendChatRequest();

		expect(credential(only(API, "POST"))).toEqual({});
		expect(credential(only(TOOLS_URL, "GET"))).toEqual({});
		expect(credential(only(MINT_URL, "POST"))).toEqual({
			authorization: "Bearer wwp_upload",
			"x-upload-only": "yes",
		});
	});
});

describe("ChatEmbed — a queued message taken back", () => {
	test("discards its document with the merged credential", async () => {
		chatStatus = "streaming";
		await renderEmbed({ headers: CHAT_ONLY, uploadHeaders: UPLOAD_ONLY });

		attachPdf();
		await settle();
		await submitComposer();

		click('button[aria-label="Remove from queue"]');
		await settle();

		expect(credential(only(DISCARD_URL, "DELETE"))).toEqual(MERGED_CREDENTIAL);
	});

	test("a queued discard keeps a header only headers sets", async () => {
		chatStatus = "streaming";
		await renderEmbed({
			headers: {
				Authorization: "Bearer chat_credential",
				"X-Tenant-Id": "acme",
			},
			uploadHeaders: { Authorization: "Bearer wwp_upload" },
		});

		attachPdf();
		await settle();
		await submitComposer();

		click('button[aria-label="Remove from queue"]');
		await settle();

		expect(credential(only(DISCARD_URL, "DELETE"))).toEqual({
			authorization: "Bearer wwp_upload",
			"x-tenant-id": "acme",
		});
	});
});

/**
 * `Headers` trims a leading or trailing line break but refuses one folded into
 * the middle of a value, which is the shape a header injection takes.
 */
const INJECTED = "Bearer abc\nX-Injected: 1";

describe("ChatEmbed — a header the platform cannot put on the wire", () => {
	/** The message the widget leaves under the composer. */
	function shownError(): string {
		return document.querySelector("output")?.textContent ?? "";
	}

	/** Mounts, attaches one file, and reports what the visitor is left looking at. */
	async function failedAttach(overrides: Partial<EmbedProps> = {}) {
		calls = [];
		minted = 0;
		await renderEmbed(overrides);

		attachPdf();
		await settle();

		const seen = {
			shown: shownError(),
			rendered: container?.textContent ?? "",
			mints: callsTo(MINT_URL, "POST").length,
		};
		unmountEmbed();
		return seen;
	}

	/** What the widget shows when the mint fails for a reason nobody disputes. */
	async function mintFailureText(): Promise<string> {
		mintFails = true;
		const seen = await failedAttach({ headers: CHAT_ONLY });
		mintFails = false;
		return seen.shown;
	}

	test("a header name the wire rejects reads as an ordinary upload failure", async () => {
		const ordinary = await mintFailureText();
		const seen = await failedAttach({ headers: { "X-Tenant Id": "acme" } });

		expect(seen.shown).toBe(ordinary);
		expect(seen.shown).not.toBe("");
		expect(seen.mints).toBe(0);
	});

	test("the parser's wording for a bad name never reaches the visitor", async () => {
		const seen = await failedAttach({ headers: { "X-Tenant Id": "acme" } });

		expect(seen.rendered).not.toContain("Invalid header name");
		expect(seen.rendered).not.toContain("X-Tenant Id");
	});

	test("a token with a line break folded into it reads as an ordinary upload failure", async () => {
		const ordinary = await mintFailureText();
		const seen = await failedAttach({ headers: { Authorization: INJECTED } });

		expect(seen.shown).toBe(ordinary);
		expect(seen.mints).toBe(0);
	});

	test("a rejected value is never quoted back at the visitor", async () => {
		const seen = await failedAttach({ headers: { Authorization: INJECTED } });

		expect(seen.rendered).not.toContain("invalid value");
		expect(seen.rendered).not.toContain("X-Injected");
	});

	test("a token the host forgot to trim is trimmed, not refused", async () => {
		calls = [];
		minted = 0;
		await renderEmbed({ headers: { Authorization: "Bearer untrimmed\n" } });

		attachPdf();
		await settle();

		expect(credential(only(MINT_URL, "POST"))).toEqual({
			authorization: "Bearer untrimmed",
		});
		expect(shownError()).toBe("");
	});

	test("a header uploadHeaders alone cannot send fails the same way", async () => {
		const ordinary = await mintFailureText();
		const seen = await failedAttach({
			headers: CHAT_ONLY,
			uploadHeaders: { "X-Tenant Id": "acme" },
		});

		expect(seen.shown).toBe(ordinary);
		expect(seen.mints).toBe(0);
		expect(seen.rendered).not.toContain("Invalid header name");
	});

	test("a value uploadHeaders alone cannot send fails the same way", async () => {
		const ordinary = await mintFailureText();
		const seen = await failedAttach({
			headers: CHAT_ONLY,
			uploadHeaders: { Authorization: INJECTED },
		});

		expect(seen.shown).toBe(ordinary);
		expect(seen.mints).toBe(0);
		expect(seen.rendered).not.toContain("invalid value");
	});

	test("only the document leg is lost: the chat leg still spends its headers", async () => {
		calls = [];
		await renderEmbed({
			headers: CHAT_ONLY,
			uploadHeaders: { "X-Tenant Id": "acme" },
		});

		attachPdf();
		await settle();
		await sendChatRequest();

		expect(credential(only(TOOLS_URL, "GET"))).toEqual(CHAT_CREDENTIAL);
		expect(credential(only(API, "POST"))).toEqual(CHAT_CREDENTIAL);
		expect(callsTo(MINT_URL, "POST").length).toBe(0);
	});

	/** Counts what one attempt schedules and hangs on the signal it was handed. */
	async function attemptUpload(records: {
		headers?: Record<string, string>;
		uploadHeaders?: Record<string, string>;
	}) {
		const controller = new AbortController();
		const { signal } = controller;
		let attached = 0;
		const add = signal.addEventListener.bind(signal);
		const remove = signal.removeEventListener.bind(signal);
		signal.addEventListener = ((...args: Parameters<typeof add>) => {
			attached += 1;
			return add(...args);
		}) as typeof signal.addEventListener;
		signal.removeEventListener = ((...args: Parameters<typeof remove>) => {
			attached -= 1;
			return remove(...args);
		}) as typeof signal.removeEventListener;

		const armed = new Set<unknown>();
		const realSetTimeout = globalThis.setTimeout;
		const realClearTimeout = globalThis.clearTimeout;
		// biome-ignore lint/suspicious/noExplicitAny: counting what the attempt schedules
		(globalThis as any).setTimeout = (...args: any[]) => {
			// biome-ignore lint/suspicious/noExplicitAny: counting what the attempt schedules
			const id = (realSetTimeout as any)(...args);
			armed.add(id);
			return id;
		};
		// biome-ignore lint/suspicious/noExplicitAny: counting what the attempt schedules
		(globalThis as any).clearTimeout = (id: any) => {
			armed.delete(id);
			return realClearTimeout(id);
		};

		let thrown: unknown;
		try {
			await uploadDocument({
				file: new File(["xx"], "policy.pdf", { type: "application/pdf" }),
				api: API,
				signal,
				...records,
			});
		} catch (error) {
			thrown = error;
		} finally {
			globalThis.setTimeout = realSetTimeout;
			globalThis.clearTimeout = realClearTimeout;
			for (const id of armed) {
				realClearTimeout(id as ReturnType<typeof setTimeout>);
			}
		}

		return { thrown, stillArmed: armed.size, stillAttached: attached };
	}

	test("a rejected header still gives back the timer and the listener", async () => {
		const left = await attemptUpload({ headers: { "X-Tenant Id": "acme" } });

		expect(left.stillArmed).toBe(0);
		expect(left.stillAttached).toBe(0);
		expect(left.thrown).toBeInstanceOf(DocumentUploadError);
	});

	test("a rejected uploadHeaders gives them back too", async () => {
		const left = await attemptUpload({
			headers: CHAT_ONLY,
			uploadHeaders: { Authorization: INJECTED },
		});

		expect(left.stillArmed).toBe(0);
		expect(left.stillAttached).toBe(0);
		expect(left.thrown).toBeInstanceOf(DocumentUploadError);
	});

	test("the typed failure is what the upload rejects with", async () => {
		const left = await attemptUpload({ headers: { "X-Tenant Id": "acme" } });

		expect((left.thrown as InstanceType<typeof DocumentUploadError>).code).toBe(
			"upload_failed",
		);
	});
});
