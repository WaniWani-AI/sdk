import { afterEach, describe, expect, test } from "bun:test";
import { z } from "zod";
import type { KbClient } from "../../../kb/types.js";
import type { TrackInput } from "../../../tracking/@types.js";
import { createScopedClient } from "../scoped-client.js";
import { extractAttachedDocuments } from "../utils.js";

describe("extractAttachedDocuments", () => {
	test("returns an empty list when the host uploads nothing", () => {
		expect(extractAttachedDocuments(undefined)).toEqual([]);
		expect(extractAttachedDocuments({})).toEqual([]);
		expect(
			extractAttachedDocuments({ "waniwani/sessionId": "sess-1" }),
		).toEqual([]);
	});

	test("resolves the list the chat route stamped under waniwani/documents", () => {
		expect(
			extractAttachedDocuments({
				"waniwani/documents": [
					{
						documentId: "doc_1",
						filename: "policy.pdf",
						mediaType: "application/pdf",
					},
					{
						documentId: "doc_2",
						filename: "scan.png",
						mediaType: "image/png",
					},
				],
			}),
		).toEqual([
			{
				documentId: "doc_1",
				filename: "policy.pdf",
				mediaType: "application/pdf",
			},
			{ documentId: "doc_2", filename: "scan.png", mediaType: "image/png" },
		]);
	});

	test("accepts a lone document object, not just a list", () => {
		expect(
			extractAttachedDocuments({
				"waniwani/documents": { documentId: "doc_1", filename: "a.pdf" },
			}),
		).toEqual([
			{
				documentId: "doc_1",
				filename: "a.pdf",
				mediaType: "application/octet-stream",
			},
		]);
	});

	test("collapses a repeated id to one handle", () => {
		expect(
			extractAttachedDocuments({
				"waniwani/documents": [
					{ documentId: "doc_1", filename: "a.pdf" },
					{ documentId: "doc_1", filename: "a.pdf" },
				],
			}),
		).toHaveLength(1);
	});

	test("shrugs off a meta value of the wrong shape", () => {
		for (const raw of [
			null,
			"doc_1",
			42,
			true,
			[],
			{},
			[null, "doc_1", 42, []],
			[{ filename: "no-id.pdf" }],
			{ documents: [{ documentId: "doc_1" }] },
		]) {
			expect(extractAttachedDocuments({ "waniwani/documents": raw })).toEqual(
				[],
			);
		}
	});

	test("does not read files attached by a non-widget host", () => {
		expect(
			extractAttachedDocuments({
				"openai/fileParams": [
					{ url: "https://files.test/a.pdf", filename: "a.pdf" },
				],
			}),
		).toEqual([]);
	});
});

const unusedKb = {} as KbClient;

function makeBase() {
	return {
		track: async (_event: TrackInput) => ({ eventId: "evt_test" }),
		identify: async () => ({ eventId: "evt_id" }),
		kb: unusedKb,
	};
}

const totalSchema = z.object({ total: z.number() });

interface CapturedCall {
	url: string;
	body: Record<string, unknown>;
}

function stubFetch(): CapturedCall[] {
	const calls: CapturedCall[] = [];
	globalThis.fetch = Object.assign(
		async (input: unknown, init?: RequestInit) => {
			calls.push({
				url: String(input),
				body: typeof init?.body === "string" ? JSON.parse(init.body) : {},
			});
			return new Response(
				JSON.stringify({
					success: true,
					message: "ok",
					data: {
						fields: { total: 42 },
						pageCount: 1,
						pageConfidence: 0.9,
						documentId: "doc_1",
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		},
		{ preconnect: () => {} },
	);
	return calls;
}

const originalFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = originalFetch;
});

describe("scoped client — attachedDocuments", () => {
	test("exposes the turn's uploads as handles", () => {
		const scoped = createScopedClient(
			makeBase(),
			{
				"waniwani/sessionId": "sess-1",
				"waniwani/documents": [
					{
						documentId: "doc_1",
						filename: "policy.pdf",
						mediaType: "application/pdf",
					},
				],
			},
			{ apiKey: "wwk_test" },
		);

		expect(scoped.attachedDocuments).toEqual([
			{
				documentId: "doc_1",
				filename: "policy.pdf",
				mediaType: "application/pdf",
			},
		]);
	});

	test("is empty on a host that uploads nothing", () => {
		const scoped = createScopedClient(
			makeBase(),
			{ "waniwani/sessionId": "sess-1" },
			{ apiKey: "wwk_test" },
		);

		expect(scoped.attachedDocuments).toEqual([]);
		expect(scoped.attachedFiles).toEqual([]);
	});

	test("a handle spread into extract() sends the id alone, carrying the turn's session", async () => {
		const calls = stubFetch();
		const scoped = createScopedClient(
			makeBase(),
			{
				"waniwani/sessionId": "sess-9",
				"waniwani/documents": [
					{
						documentId: "doc_1",
						filename: "policy.pdf",
						mediaType: "application/pdf",
					},
				],
			},
			{ apiUrl: "https://example.test", apiKey: "wwk_test" },
		);

		const handle = scoped.attachedDocuments[0];
		if (!handle) {
			throw new Error("no attached document");
		}
		await scoped.documents.extract({
			documentId: handle.documentId,
			schema: totalSchema,
		});

		expect(calls[0]?.body.documentId).toBe("doc_1");
		expect(calls[0]?.body).not.toHaveProperty("url");
		expect(calls[0]?.body).not.toHaveProperty("filename");
		expect(calls[0]?.body.sessionId).toBe("sess-9");
	});
});
