import { describe, expect, test } from "bun:test";
import { readAttachedDocuments } from "./messages.js";

const parse = (json: string): unknown => JSON.parse(json);

describe("readAttachedDocuments — the widget's top-level documents field", () => {
	test("reads the ids the widget put beside messages", () => {
		expect(
			readAttachedDocuments({
				messages: [
					{ role: "user", parts: [{ type: "text", text: "read it" }] },
				],
				documents: [
					{
						documentId: "doc_1",
						filename: "policy.pdf",
						mediaType: "application/pdf",
					},
				],
			}),
		).toEqual([
			{
				documentId: "doc_1",
				filename: "policy.pdf",
				mediaType: "application/pdf",
			},
		]);
	});

	test("accepts the documents array on its own", () => {
		expect(
			readAttachedDocuments([
				{
					documentId: "doc_1",
					filename: "a.pdf",
					mediaType: "application/pdf",
				},
			]),
		).toEqual([
			{ documentId: "doc_1", filename: "a.pdf", mediaType: "application/pdf" },
		]);
	});

	test("accepts a lone document object", () => {
		expect(
			readAttachedDocuments({
				documents: { documentId: "doc_1", filename: "a.pdf" },
			}),
		).toHaveLength(1);
	});

	test("reads the snake_case spellings a route may forward", () => {
		expect(
			readAttachedDocuments({
				documents: [
					{
						document_id: "doc_1",
						file_name: "scan.tiff",
						content_type: "image/tiff",
					},
				],
			}),
		).toEqual([
			{ documentId: "doc_1", filename: "scan.tiff", mediaType: "image/tiff" },
		]);
	});

	test("only the id is load-bearing: an entry without the descriptive two still resolves", () => {
		expect(
			readAttachedDocuments({ documents: [{ documentId: "doc_1" }] }),
		).toEqual([
			{
				documentId: "doc_1",
				filename: "document",
				mediaType: "application/octet-stream",
			},
		]);
	});

	test("drops entries with no usable id", () => {
		expect(
			readAttachedDocuments({
				documents: [
					{},
					{ documentId: "" },
					{ documentId: 42 },
					{ documentId: null },
					{ filename: "orphan.pdf" },
					"doc_1",
					null,
					[{ documentId: "nested" }],
				],
			}),
		).toEqual([]);
	});

	test("collapses repeated ids to one, keeping the first entry's descriptors", () => {
		expect(
			readAttachedDocuments({
				documents: [
					{ documentId: "doc_1", filename: "first.pdf" },
					{ documentId: "doc_1", filename: "second.pdf" },
					{ documentId: "doc_2", filename: "other.pdf" },
				],
			}),
		).toEqual([
			{
				documentId: "doc_1",
				filename: "first.pdf",
				mediaType: "application/octet-stream",
			},
			{
				documentId: "doc_2",
				filename: "other.pdf",
				mediaType: "application/octet-stream",
			},
		]);
	});

	test("preserves the order the visitor attached them in", () => {
		const ids = readAttachedDocuments({
			documents: [
				{ documentId: "doc_c" },
				{ documentId: "doc_a" },
				{ documentId: "doc_b" },
			],
		}).map((d) => d.documentId);

		expect(ids).toEqual(["doc_c", "doc_a", "doc_b"]);
	});
});

describe("readAttachedDocuments — the messages fallback", () => {
	test("reads ids off the latest user turn's parts", () => {
		expect(
			readAttachedDocuments({
				messages: [
					{ role: "user", parts: [{ type: "text", text: "hi" }] },
					{ role: "assistant", parts: [{ type: "text", text: "hello" }] },
					{
						role: "user",
						parts: [
							{ type: "text", text: "read this" },
							{
								type: "file",
								documentId: "doc_2",
								filename: "b.pdf",
								mediaType: "application/pdf",
							},
						],
					},
				],
			}),
		).toEqual([
			{ documentId: "doc_2", filename: "b.pdf", mediaType: "application/pdf" },
		]);
	});

	test("reads an id nested under a part's data envelope", () => {
		expect(
			readAttachedDocuments({
				messages: [
					{
						role: "user",
						parts: [
							{
								type: "data-document",
								data: { documentId: "doc_3", filename: "c.pdf" },
							},
						],
					},
				],
			}),
		).toEqual([
			{
				documentId: "doc_3",
				filename: "c.pdf",
				mediaType: "application/octet-stream",
			},
		]);
	});

	test("ignores documents from earlier turns — only the latest user turn counts", () => {
		expect(
			readAttachedDocuments({
				messages: [
					{ role: "user", parts: [{ documentId: "doc_old" }] },
					{ role: "assistant", parts: [{ type: "text", text: "ok" }] },
					{ role: "user", parts: [{ documentId: "doc_new" }] },
				],
			}).map((d) => d.documentId),
		).toEqual(["doc_new"]);
	});

	test("ignores ids that only ever appear on an assistant turn", () => {
		expect(
			readAttachedDocuments({
				messages: [
					{ role: "user", parts: [{ type: "text", text: "hi" }] },
					{ role: "assistant", parts: [{ documentId: "doc_assistant" }] },
				],
			}),
		).toEqual([]);
	});

	test("accepts a bare messages array", () => {
		expect(
			readAttachedDocuments([
				{ role: "user", parts: [{ documentId: "doc_1" }] },
			]).map((d) => d.documentId),
		).toEqual(["doc_1"]);
	});

	test("a declared documents field wins over anything in the transcript", () => {
		expect(
			readAttachedDocuments({
				documents: [{ documentId: "doc_declared" }],
				messages: [{ role: "user", parts: [{ documentId: "doc_in_parts" }] }],
			}).map((d) => d.documentId),
		).toEqual(["doc_declared"]);
	});

	test("falls back to the transcript when every declared entry is unusable", () => {
		expect(
			readAttachedDocuments({
				documents: [{ filename: "no-id.pdf" }],
				messages: [{ role: "user", parts: [{ documentId: "doc_in_parts" }] }],
			}).map((d) => d.documentId),
		).toEqual(["doc_in_parts"]);
	});
});

describe("readAttachedDocuments — untrusted input never throws", () => {
	test("returns an empty list for anything that is not a body", () => {
		for (const input of [
			undefined,
			null,
			"",
			"documents",
			0,
			42,
			true,
			[],
			{},
			{ documents: null },
			{ documents: "doc_1" },
			{ documents: 7 },
			{ messages: null },
			{ messages: "hi" },
			{ messages: [] },
			{ messages: [null, 1, "x"] },
			{ messages: [{ role: "user" }] },
			{ messages: [{ role: "user", parts: null }] },
			{ messages: [{ role: "user", parts: "text" }] },
			{ messages: [{ role: "user", parts: [null, 1, "x", []] }] },
		]) {
			expect(readAttachedDocuments(input)).toEqual([]);
		}
	});

	test("survives a body parsed straight off the wire", () => {
		expect(
			readAttachedDocuments(
				parse(
					'{"documents":[{"documentId":"doc_1","filename":"a.pdf","mediaType":"application/pdf"},{"documentId":"doc_1"}],"messages":[{"role":"user","parts":[]}]}',
				),
			),
		).toEqual([
			{ documentId: "doc_1", filename: "a.pdf", mediaType: "application/pdf" },
		]);
	});

	test("a prototype-shaped key on the wire does not leak into the result", () => {
		const [document] = readAttachedDocuments(
			parse(
				'{"documents":[{"documentId":"doc_1","__proto__":{"filename":"x"}}]}',
			),
		);

		expect(document).toEqual({
			documentId: "doc_1",
			filename: "document",
			mediaType: "application/octet-stream",
		});
		expect(({} as Record<string, unknown>).filename).toBeUndefined();
	});

	test("a deeply self-referential body still resolves", () => {
		const body: Record<string, unknown> = {
			documents: [{ documentId: "doc_1" }],
		};
		body.self = body;

		expect(readAttachedDocuments(body)).toHaveLength(1);
	});
});

describe("round trip — what the widget uploads is what the server route reads", () => {
	test("an UploadedDocument survives the body unchanged and is ready for extract()", async () => {
		const { uploadDocument } = await import(
			"../chat/web/lib/document-upload.js"
		);
		type Uploaded = Awaited<ReturnType<typeof uploadDocument>>;

		const uploaded: Uploaded = {
			documentId: "doc_upload_1",
			filename: "policy.pdf",
			mediaType: "application/pdf",
		};

		const body = JSON.parse(
			JSON.stringify({ messages: [], documents: [uploaded] }),
		);

		expect(readAttachedDocuments(body)).toEqual([uploaded]);
	});
});
