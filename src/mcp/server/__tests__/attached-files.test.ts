import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { z } from "zod";
import type { KbClient } from "../../../kb/types.js";
import type { TrackInput } from "../../../tracking/@types.js";
import { createScopedClient } from "../scoped-client.js";
import { extractAttachedFiles } from "../utils.js";

describe("extractAttachedFiles", () => {
	test("returns an empty list when the host attached nothing", () => {
		expect(extractAttachedFiles(undefined)).toEqual([]);
		expect(extractAttachedFiles({})).toEqual([]);
		expect(extractAttachedFiles({ "waniwani/sessionId": "sess-1" })).toEqual(
			[],
		);
	});

	test("resolves a ChatGPT attachment keyed by tool parameter name", () => {
		expect(
			extractAttachedFiles({
				"openai/fileParams": {
					document: {
						url: "https://files.test/invoice.pdf",
						name: "invoice.pdf",
						mime_type: "application/pdf",
					},
				},
			}),
		).toEqual([
			{ url: "https://files.test/invoice.pdf", filename: "invoice.pdf" },
		]);
	});

	test("resolves a list container in host order", () => {
		expect(
			extractAttachedFiles({
				"openai/fileParams": [
					{ url: "https://files.test/a.pdf", filename: "a.pdf" },
					{ url: "https://files.test/b.png", filename: "b.png" },
				],
			}),
		).toEqual([
			{ url: "https://files.test/a.pdf", filename: "a.pdf" },
			{ url: "https://files.test/b.png", filename: "b.png" },
		]);
	});

	test("reads the snake_case spellings a host may use", () => {
		expect(
			extractAttachedFiles({
				"openai/fileParams": {
					attachment: {
						download_url: "https://files.test/scan.tiff",
						file_name: "scan.tiff",
					},
				},
			}),
		).toEqual([{ url: "https://files.test/scan.tiff", filename: "scan.tiff" }]);
	});

	test("derives a filename from the url when the host names none", () => {
		expect(
			extractAttachedFiles({
				"waniwani/fileParams": [{ url: "https://files.test/x/policy.pdf" }],
			}),
		).toEqual([
			{ url: "https://files.test/x/policy.pdf", filename: "policy.pdf" },
		]);
	});

	test("prefers the host's filename over one derived from the url", () => {
		expect(
			extractAttachedFiles({
				"waniwani/fileParams": [
					{ url: "https://files.test/x/opaque-id", filename: "policy.pdf" },
				],
			}),
		).toEqual([
			{ url: "https://files.test/x/opaque-id", filename: "policy.pdf" },
		]);
	});

	test("ignores a non-string filename and falls back to the url", () => {
		expect(
			extractAttachedFiles({
				"waniwani/fileParams": [
					{ url: "https://files.test/policy.pdf", filename: 42 },
				],
			}),
		).toEqual([
			{ url: "https://files.test/policy.pdf", filename: "policy.pdf" },
		]);
	});

	test("percent-escapes in the path decode into the filename, url untouched", () => {
		expect(
			extractAttachedFiles({
				"waniwani/fileParams": [
					{ url: "https://files.test/a%20b/rapport%20final.pdf?sig=x" },
				],
			}),
		).toEqual([
			{
				url: "https://files.test/a%20b/rapport%20final.pdf?sig=x",
				filename: "rapport final.pdf",
			},
		]);
	});

	test("skips entries with nothing fetchable", () => {
		expect(
			extractAttachedFiles({
				"openai/fileParams": [
					{},
					{ id: "file-abc123", name: "invoice.pdf" },
					{ url: "file-abc123" },
					{ url: "" },
					{ url: 42 },
					{ url: null },
				],
			}),
		).toEqual([]);
	});

	test("skips urls the platform cannot fetch over http", () => {
		expect(
			extractAttachedFiles({
				"openai/fileParams": [
					{ url: "data:application/pdf;base64,JVBERi0=", name: "a.pdf" },
					{ url: "file:///etc/passwd", name: "passwd" },
					{ url: "ftp://files.test/a.pdf", name: "a.pdf" },
					{ url: "blob:https://files.test/abc", name: "a.pdf" },
				],
			}),
		).toEqual([]);
	});

	test("every resolved file carries a non-empty filename", () => {
		const files = extractAttachedFiles({
			"waniwani/fileParams": [
				{ url: "https://files.test" },
				{ url: "https://files.test/" },
				{ url: "https://files.test/?download=1" },
			],
		});

		expect(files.length).toBeGreaterThan(0);
		for (const file of files) {
			expect(file.filename.length).toBeGreaterThan(0);
		}
	});

	test("a ChatGPT signed url keeps the query that makes it fetchable", () => {
		const signed =
			"https://files.oaiusercontent.com/file-abc123?se=2026-01-01&sig=xyz%2Fabc";
		const files = extractAttachedFiles({
			"openai/fileParams": {
				document: { url: signed, mime_type: "application/pdf" },
			},
		});

		expect(files).toHaveLength(1);
		expect(files[0]?.url).toBe(signed);
	});

	test("resolves an MCP resource link, whose url lives under uri", () => {
		expect(
			extractAttachedFiles({
				"waniwani/fileParams": [
					{
						type: "resource_link",
						uri: "https://files.test/invoice.pdf",
						name: "invoice.pdf",
						mimeType: "application/pdf",
					},
				],
			}),
		).toEqual([
			{ url: "https://files.test/invoice.pdf", filename: "invoice.pdf" },
		]);
	});

	test("waniwani/fileParams wins over openai/fileParams, like every sibling key list", () => {
		expect(
			extractAttachedFiles({
				"waniwani/fileParams": [
					{ url: "https://cdn.waniwani.test/rehosted.pdf", filename: "a.pdf" },
				],
				"openai/fileParams": {
					document: { url: "https://files.test/original.pdf", name: "a.pdf" },
				},
			}),
		).toEqual([
			{ url: "https://cdn.waniwani.test/rehosted.pdf", filename: "a.pdf" },
		]);
	});

	test("falls back to openai/fileParams when the waniwani key is empty", () => {
		expect(
			extractAttachedFiles({
				"waniwani/fileParams": [],
				"openai/fileParams": {
					document: { url: "https://files.test/original.pdf", name: "a.pdf" },
				},
			}),
		).toEqual([{ url: "https://files.test/original.pdf", filename: "a.pdf" }]);
	});
});

interface CapturedCall {
	url: string;
	body: Record<string, unknown>;
}

const originalFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = originalFetch;
});

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
						fields: { total: 1 },
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

const unusedKb: KbClient = {
	ingest: () => Promise.reject(new Error("kb is unused here")),
	search: () => Promise.reject(new Error("kb is unused here")),
	sources: () => Promise.reject(new Error("kb is unused here")),
};

function makeBase() {
	return {
		track: async (_event: TrackInput) => ({ eventId: "evt_test" }),
		identify: async () => ({ eventId: "evt_id" }),
		kb: unusedKb,
	};
}

const totalSchema = z.object({ total: z.number() });

describe("scoped client documents wiring", () => {
	test("attachedFiles exposes the attachments on this tool call", () => {
		const scoped = createScopedClient(
			makeBase(),
			{
				"waniwani/sessionId": "sess-9",
				"openai/fileParams": {
					document: {
						url: "https://files.test/invoice.pdf",
						name: "invoice.pdf",
					},
				},
			},
			{ apiUrl: "https://example.test", apiKey: "wwk_test" },
		);

		expect(scoped.attachedFiles).toEqual([
			{ url: "https://files.test/invoice.pdf", filename: "invoice.pdf" },
		]);
	});

	test("attachedFiles is empty on a host that attaches nothing", () => {
		const scoped = createScopedClient(
			makeBase(),
			{ "waniwani/sessionId": "sess-9" },
			{ apiUrl: "https://example.test", apiKey: "wwk_test" },
		);

		expect(scoped.attachedFiles).toEqual([]);
	});

	test("an attached file spreads straight into documents.extract", async () => {
		const calls = stubFetch();
		const scoped = createScopedClient(
			makeBase(),
			{
				"openai/fileParams": {
					document: {
						url: "https://files.test/invoice.pdf",
						name: "invoice.pdf",
					},
				},
			},
			{ apiUrl: "https://example.test", apiKey: "wwk_test" },
		);
		const attached = scoped.attachedFiles[0];
		if (!attached) {
			throw new Error("no attached file resolved");
		}

		await scoped.documents.extract({ ...attached, schema: totalSchema });

		expect(calls[0]?.body.url).toBe("https://files.test/invoice.pdf");
		expect(calls[0]?.body.filename).toBe("invoice.pdf");
	});

	test("documents.extract carries the request's sessionId and correlationId", async () => {
		const calls = stubFetch();
		const scoped = createScopedClient(
			makeBase(),
			{ "waniwani/sessionId": "sess-9", "openai/requestId": "req-7" },
			{ apiUrl: "https://example.test", apiKey: "wwk_test" },
		);

		await scoped.documents.extract({
			url: "https://files.test/invoice.pdf",
			filename: "invoice.pdf",
			schema: totalSchema,
		});

		expect(calls[0]?.body.sessionId).toBe("sess-9");
		expect(calls[0]?.body.correlationId).toBe("req-7");
	});

	test("an explicit sessionId on the call wins over the request's", async () => {
		const calls = stubFetch();
		const scoped = createScopedClient(
			makeBase(),
			{ "waniwani/sessionId": "sess-9" },
			{ apiUrl: "https://example.test", apiKey: "wwk_test" },
		);

		await scoped.documents.extract({
			url: "https://files.test/invoice.pdf",
			filename: "invoice.pdf",
			schema: totalSchema,
			sessionId: "sess-explicit",
		});

		expect(calls[0]?.body.sessionId).toBe("sess-explicit");
	});

	test("documents.extract targets the resolved api url", async () => {
		const calls = stubFetch();
		const scoped = createScopedClient(
			makeBase(),
			{},
			{ apiUrl: "https://eu.app.waniwani.ai", apiKey: "wwk_test" },
		);

		await scoped.documents.extract({
			url: "https://files.test/invoice.pdf",
			filename: "invoice.pdf",
			schema: totalSchema,
		});

		expect(calls[0]?.url).toBe(
			"https://eu.app.waniwani.ai/api/mcp/modules/documents/extract",
		);
	});

	test("documents.extract keeps the caller's page selection", async () => {
		const calls = stubFetch();
		const scoped = createScopedClient(
			makeBase(),
			{ "waniwani/sessionId": "sess-9" },
			{ apiUrl: "https://example.test", apiKey: "wwk_test" },
		);

		await scoped.documents.extract({
			url: "https://files.test/invoice.pdf",
			filename: "invoice.pdf",
			schema: totalSchema,
			pages: [0],
		});

		expect(calls[0]?.body.pages).toEqual([0]);
	});
});

describe("scoped client apiUrl resolution", () => {
	const previous = process.env.WANIWANI_API_URL;

	beforeEach(() => {
		delete process.env.WANIWANI_API_URL;
	});

	afterEach(() => {
		if (previous === undefined) {
			delete process.env.WANIWANI_API_URL;
		} else {
			process.env.WANIWANI_API_URL = previous;
		}
	});

	test("an explicit config apiUrl wins over WANIWANI_API_URL", async () => {
		process.env.WANIWANI_API_URL = "https://eu.app.waniwani.ai";
		const calls = stubFetch();
		const scoped = createScopedClient(
			makeBase(),
			{ "waniwani/sessionId": "sess-9" },
			{ apiUrl: "https://self.hosted.test", apiKey: "wwk_test" },
		);

		await scoped.documents.extract({
			url: "https://files.test/invoice.pdf",
			filename: "invoice.pdf",
			schema: totalSchema,
		});

		expect(calls[0]?.url).toBe(
			"https://self.hosted.test/api/mcp/modules/documents/extract",
		);
	});

	test("falls back to WANIWANI_API_URL when the config carries no apiUrl", async () => {
		process.env.WANIWANI_API_URL = "https://eu.app.waniwani.ai";
		const calls = stubFetch();
		const scoped = createScopedClient(
			makeBase(),
			{ "waniwani/sessionId": "sess-9" },
			{ apiKey: "wwk_test" },
		);

		await scoped.documents.extract({
			url: "https://files.test/invoice.pdf",
			filename: "invoice.pdf",
			schema: totalSchema,
		});

		expect(calls[0]?.url).toBe(
			"https://eu.app.waniwani.ai/api/mcp/modules/documents/extract",
		);
	});
});
