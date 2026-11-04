import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { Window } from "happy-dom";

// biome-ignore lint/suspicious/noExplicitAny: test setup
(globalThis as any).indexedDB = new IDBFactory();
// biome-ignore lint/suspicious/noExplicitAny: test setup
(globalThis as any).IDBKeyRange = IDBKeyRange;

const win = new Window({ url: "https://shop.example.com" });
for (const key of [
	"document",
	"navigator",
	"HTMLElement",
	"HTMLDivElement",
	"HTMLAnchorElement",
	"HTMLButtonElement",
	"HTMLInputElement",
	"HTMLTextAreaElement",
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
(URL as any).createObjectURL = () => "blob:https://shop.example.com/1";
// biome-ignore lint/suspicious/noExplicitAny: happy-dom has no object-URL store
(URL as any).revokeObjectURL = () => {};

const { act, createElement } = await import("react");
const { createRoot } = await import("react-dom/client");
type Root = ReturnType<typeof createRoot>;

const mockSendMessage = mock(() => {});

// @ts-expect-error -- bun:test `mock.module` exists at runtime but has no TS type
mock.module("@ai-sdk/react", () => ({
	useChat() {
		return {
			messages: [],
			sendMessage: mockSendMessage,
			setMessages: mock(() => {}),
			status: "ready",
		};
	},
}));

// @ts-expect-error -- bun:test `mock.module` exists at runtime but has no TS type
mock.module("../../lib/lenient-chat-transport", () => ({
	LenientChatTransport: class {},
}));

let requestedUrls: string[] = [];
let mintedFilenames: string[] = [];
const originalFetch = globalThis.fetch;

beforeEach(() => {
	requestedUrls = [];
	mintedFilenames = [];
	globalThis.fetch = mock(async (input: unknown, init: unknown) => {
		const href = String(input);
		requestedUrls.push(href);
		if (href.includes("/upload-url")) {
			const body = (init as RequestInit | undefined)?.body;
			const minted = JSON.parse(String(body ?? "{}")) as {
				filename?: string;
			};
			if (minted.filename) {
				mintedFilenames.push(minted.filename);
			}
			return Response.json({
				success: true,
				data: {
					documentId: `doc_${mintedFilenames.length}`,
					uploadUrl: "https://storage.test/put/doc_1",
					headers: {},
				},
			});
		}
		return Response.json({ tools: [] });
	}) as unknown as typeof fetch;
});

afterEach(() => {
	globalThis.fetch = originalFetch;
});

const { ChatEmbed } = await import("../chat-embed");

const DOCUMENT_UPLOAD = {
	enabled: true,
	maxBytes: 20 * 1024 * 1024,
	maxPdfPages: 30,
	maxFiles: 10,
	accept: ["application/pdf", "image/png"],
};

let root: Root | null = null;
let container: HTMLElement | null = null;

type EmbedProps = Parameters<typeof ChatEmbed>[0];

async function renderEmbed(overrides: Partial<EmbedProps> = {}) {
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);

	await act(async () => {
		root?.render(
			createElement(ChatEmbed, {
				api: "https://app.waniwani.ai/api/mcp/chat",
				headers: { Authorization: "Bearer wwp_test" },
				...overrides,
			} as EmbedProps),
		);
	});
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 20));
	});
}

afterEach(() => {
	if (root) {
		act(() => {
			root?.unmount();
		});
		root = null;
	}
	container?.remove();
	container = null;
});

function paperclip(): Element | null {
	return document.querySelector('input[type="file"]');
}

function pasteFiles(files: { name: string; type: string }[]) {
	const textarea = document.querySelector("textarea");
	if (!textarea) {
		throw new Error("no textarea rendered");
	}
	act(() => {
		const event = new win.Event("paste", { bubbles: true, cancelable: true });
		// biome-ignore lint/suspicious/noExplicitAny: happy-dom has no ClipboardEvent with items
		(event as any).clipboardData = {
			items: files.map(({ name, type }) => ({
				kind: "file",
				getAsFile: () => new File(["xx"], name, { type }),
			})),
		};
		textarea.dispatchEvent(event as unknown as Event);
	});
}

function pasteFile(name: string, type: string) {
	pasteFiles([{ name, type }]);
}

function pdfs(count: number, prefix: string): { name: string; type: string }[] {
	return Array.from({ length: count }, (_, index) => ({
		name: `${prefix}-${index + 1}.pdf`,
		type: "application/pdf",
	}));
}

function chipCount(): number {
	return document.querySelectorAll('button[aria-label="Remove attachment"]')
		.length;
}

describe("ChatEmbed — who decides whether attachments are on", () => {
	test("no platform answer and no opt-in: the composer takes nothing", async () => {
		await renderEmbed();

		pasteFile("policy.pdf", "application/pdf");
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 10));
		});

		expect(chipCount()).toBe(0);
	});

	test("no platform answer but allowAttachments: the old inline path still works", async () => {
		await renderEmbed({ allowAttachments: true });

		pasteFile("policy.pdf", "application/pdf");
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 10));
		});

		expect(chipCount()).toBe(1);
		expect(requestedUrls.some((url) => url.includes("/upload-url"))).toBe(
			false,
		);
	});

	test("the platform saying off overrides allowAttachments", async () => {
		await renderEmbed({
			allowAttachments: true,
			documentUpload: { ...DOCUMENT_UPLOAD, enabled: false },
		});

		pasteFile("policy.pdf", "application/pdf");
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 10));
		});

		expect(chipCount()).toBe(0);
		expect(paperclip()?.getAttribute("accept")).toBe(
			"application/pdf,image/png",
		);
	});

	test("the platform saying on turns attachments on without allowAttachments", async () => {
		await renderEmbed({ documentUpload: DOCUMENT_UPLOAD });

		pasteFile("policy.pdf", "application/pdf");
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 20));
		});

		expect(chipCount()).toBe(1);
	});
});

describe("ChatEmbed — the upload leg is wired to the platform", () => {
	test("a pasted file mints an upload url off the chat api's origin", async () => {
		await renderEmbed({ documentUpload: DOCUMENT_UPLOAD });

		pasteFile("policy.pdf", "application/pdf");
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 20));
		});

		expect(requestedUrls).toContain(
			"https://app.waniwani.ai/api/mcp/modules/documents/upload-url",
		);
	});

	test("the picker offers exactly the types the platform accepts", async () => {
		await renderEmbed({ documentUpload: DOCUMENT_UPLOAD });

		expect(paperclip()?.getAttribute("accept")).toBe(
			"application/pdf,image/png",
		);
	});

	test("a file outside the platform's accept list is refused with a visible message", async () => {
		await renderEmbed({ documentUpload: DOCUMENT_UPLOAD });

		pasteFile("notes.txt", "text/plain");
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 10));
		});

		expect(chipCount()).toBe(0);
		expect(container?.textContent).toContain("notes.txt");
		expect(requestedUrls.some((url) => url.includes("/upload-url"))).toBe(
			false,
		);
	});
});

describe("ChatEmbed — the platform's per-request cap bounds the composer", () => {
	test("the eleventh file is refused before it costs an upload", async () => {
		await renderEmbed({ documentUpload: DOCUMENT_UPLOAD });

		pasteFiles(pdfs(11, "scan"));
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 30));
		});

		expect(chipCount()).toBe(10);
		expect(container?.textContent).not.toContain("scan-11.pdf");
		expect(mintedFilenames).toHaveLength(10);
		expect(mintedFilenames).not.toContain("scan-11.pdf");
	});

	test("a batch straddling the cap uploads only what still fits", async () => {
		await renderEmbed({ documentUpload: DOCUMENT_UPLOAD });

		pasteFiles(pdfs(8, "first"));
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 30));
		});
		pasteFiles(pdfs(5, "second"));
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 30));
		});

		expect(chipCount()).toBe(10);
		expect(mintedFilenames).toEqual([
			...pdfs(8, "first").map((f) => f.name),
			"second-1.pdf",
			"second-2.pdf",
		]);
	});

	test("without a platform cap the inline path stays uncapped", async () => {
		await renderEmbed({ allowAttachments: true });

		pasteFiles(pdfs(11, "scan"));
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 30));
		});

		expect(chipCount()).toBe(11);
	});
});
