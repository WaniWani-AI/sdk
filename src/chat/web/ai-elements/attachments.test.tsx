import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";

const win = new Window({ url: "https://shop.example.com" });
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
(win as any).SyntaxError = SyntaxError;
// biome-ignore lint/suspicious/noExplicitAny: test setup
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const { act, createElement } = await import("react");
const { createRoot } = await import("react-dom/client");
type Root = ReturnType<typeof createRoot>;

const { AttachedDocuments, readAttachedDocuments } = await import(
	"./attachments"
);
type Doc = import("../../../documents/types").AttachedDocument;

const PDF: Doc = {
	documentId: "doc_pdf",
	filename: "policy.pdf",
	mediaType: "application/pdf",
};
const IMAGE: Doc = {
	documentId: "doc_img",
	filename: "scan.png",
	mediaType: "image/png",
};
const OTHER: Doc = {
	documentId: "doc_txt",
	filename: "notes.txt",
	mediaType: "text/plain",
};

let root: Root;
let container: HTMLElement;

beforeEach(() => {
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(() => {
	act(() => {
		root.unmount();
	});
	container.remove();
});

function render(documents: Doc[]) {
	act(() => {
		root.render(createElement(AttachedDocuments, { documents }));
	});
}

function tiles(): Element[] {
	return Array.from(container.querySelectorAll("[aria-label]"));
}

function glyphOf(tile: Element): string {
	const svg = tile.querySelector("svg");
	const names = (svg?.getAttribute("class") ?? "")
		.split(/\s+/)
		.filter((token) => token.startsWith("lucide-"));
	if (names.length !== 1) {
		throw new Error(`expected one lucide glyph, got ${names.join(",")}`);
	}
	return names[0];
}

describe("readAttachedDocuments — metadata arrives from the wire and from IndexedDB, so it is never trusted", () => {
	test("a turn that carries the documents the composer uploaded reads them back", () => {
		expect(readAttachedDocuments({ documents: [PDF, IMAGE] })).toEqual([
			PDF,
			IMAGE,
		]);
	});

	test("metadata that is not an object yields nothing rather than throwing", () => {
		for (const metadata of [
			null,
			undefined,
			"documents",
			42,
			true,
			Symbol("documents"),
			() => [PDF],
		]) {
			expect(readAttachedDocuments(metadata)).toEqual([]);
		}
	});

	test("an object with no usable documents field yields nothing", () => {
		for (const metadata of [
			{},
			{ documents: null },
			{ documents: "doc_1" },
			{ documents: 3 },
			{ documents: { 0: PDF, length: 1 } },
			{ documents: new Set([PDF]) },
			[PDF],
		]) {
			expect(readAttachedDocuments(metadata)).toEqual([]);
		}
	});

	test("an array of junk entries yields nothing", () => {
		expect(
			readAttachedDocuments({
				documents: [null, undefined, 3, "doc_1", [], true, () => PDF],
			}),
		).toEqual([]);
	});

	test("an entry missing any one of the three fields is dropped", () => {
		const { documentId, filename, mediaType } = PDF;
		expect(
			readAttachedDocuments({
				documents: [
					{ filename, mediaType },
					{ documentId, mediaType },
					{ documentId, filename },
				],
			}),
		).toEqual([]);
	});

	test("an entry whose fields are the wrong type is dropped", () => {
		expect(
			readAttachedDocuments({
				documents: [
					{ ...PDF, documentId: 7 },
					{ ...PDF, filename: null },
					{ ...PDF, mediaType: { type: "application/pdf" } },
					{ ...PDF, documentId: new String("doc_pdf") },
				],
			}),
		).toEqual([]);
	});

	test("only the unusable entries are dropped, and the survivors keep their order", () => {
		expect(
			readAttachedDocuments({
				documents: [PDF, null, { filename: "orphan.pdf" }, IMAGE, 9, OTHER],
			}),
		).toEqual([PDF, IMAGE, OTHER]);
	});

	test("a survivor is handed back whole, extra fields and all", () => {
		const enriched = { ...PDF, pageCount: 3, url: "https://storage/doc_pdf" };

		expect(readAttachedDocuments({ documents: [enriched] })[0]).toBe(enriched);
	});

	test("a __proto__ payload neither throws nor pollutes Object.prototype", () => {
		const hostile = JSON.parse(
			'{"documents":[{"documentId":"a","filename":"b.pdf","mediaType":"application/pdf","__proto__":{"polluted":true}}],"__proto__":{"polluted":true}}',
		);

		expect(readAttachedDocuments(hostile)).toHaveLength(1);
		expect(
			(Object.prototype as Record<string, unknown>).polluted,
		).toBeUndefined();
		expect(({} as Record<string, unknown>).polluted).toBeUndefined();
	});

	test("a null-prototype metadata object still reads", () => {
		const metadata = Object.assign(Object.create(null), {
			documents: [PDF],
		});

		expect(readAttachedDocuments(metadata)).toEqual([PDF]);
	});
});

describe("AttachedDocuments — the sent turn shows what went with it", () => {
	test("one tile per document, in the order they were attached", () => {
		render([PDF, IMAGE, OTHER]);

		expect(tiles()).toHaveLength(3);
		expect(tiles().map((tile) => tile.getAttribute("aria-label"))).toEqual([
			"policy.pdf, PDF",
			"scan.png, Image",
			"notes.txt, File",
		]);
	});

	test("each tile names its file and labels its kind", () => {
		render([PDF]);

		expect(container.textContent).toContain("policy.pdf");
		expect(container.textContent).toContain("PDF");
	});

	test("the glyph follows the media type, not the file extension", () => {
		render([
			PDF,
			IMAGE,
			{ ...IMAGE, documentId: "doc_jpeg", mediaType: "image/jpeg" },
			OTHER,
			// A PDF named .png still reads as a PDF, and vice versa.
			{ documentId: "a", filename: "trap.png", mediaType: "application/pdf" },
			{ documentId: "b", filename: "trap.pdf", mediaType: "image/png" },
			{ documentId: "c", filename: "unknown", mediaType: "" },
		]);

		expect(tiles().map(glyphOf)).toEqual([
			"lucide-file-text",
			"lucide-image",
			"lucide-image",
			"lucide-file",
			"lucide-file-text",
			"lucide-image",
			"lucide-file",
		]);
	});

	test("no documents renders no row at all, not an empty one", () => {
		render([]);

		expect(container.innerHTML).toBe("");
	});

	test("the row wraps rather than scrolling, so a long list stays reachable", () => {
		render([PDF, IMAGE, OTHER]);

		const row = tiles()[0]?.parentElement;
		const classes = (row?.getAttribute("class") ?? "").split(/\s+/);
		expect(classes).toContain("ww:flex-wrap");
		expect(classes.some((token) => token.includes("overflow"))).toBe(false);
	});

	test("no tile states a file size, matching what ChatGPT and Claude ship", () => {
		render([PDF, IMAGE, OTHER]);

		expect(container.textContent).not.toMatch(/\d+\s?(B|KB|MB|GB|bytes)\b/i);
	});
});
