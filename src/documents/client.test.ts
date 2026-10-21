import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import { WaniWaniError } from "../error.js";
import { createDocumentsClient } from "./client.js";

const EXTRACT_URL = "https://example.test/api/mcp/modules/documents/extract";

const invoiceSchema = z.object({
	invoiceNumber: z.string(),
	total: z.number(),
	dueDate: z.string().nullable(),
});

const wireData = {
	fields: { invoiceNumber: "INV-1", total: 42.5, dueDate: null },
	pageCount: 3,
	pageConfidence: 0.94,
	documentId: "doc_123",
};

interface CapturedCall {
	url: string;
	method: string | undefined;
	headers: Record<string, string>;
	body: Record<string, unknown>;
}

const originalFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = originalFetch;
});

function stubFetch(nextResponse: () => Response): CapturedCall[] {
	const calls: CapturedCall[] = [];
	globalThis.fetch = Object.assign(
		async (input: unknown, init?: RequestInit) => {
			const headers: Record<string, string> = {};
			new Headers(init?.headers).forEach((value, key) => {
				headers[key] = value;
			});
			calls.push({
				url: String(input),
				method: init?.method,
				headers,
				body: typeof init?.body === "string" ? JSON.parse(init.body) : {},
			});
			return nextResponse();
		},
		{ preconnect: () => {} },
	);
	return calls;
}

function envelope(data: unknown, status = 200): Response {
	return new Response(JSON.stringify({ success: true, message: "ok", data }), {
		status,
		headers: { "content-type": "application/json" },
	});
}

function client(overrides?: { apiUrl?: string; apiKey?: string | undefined }) {
	return createDocumentsClient({
		apiUrl: overrides?.apiUrl ?? "https://example.test",
		apiKey: "apiKey" in (overrides ?? {}) ? overrides?.apiKey : "wwk_test",
	});
}

describe("documents.extract — request", () => {
	test("POSTs to the platform extract endpoint with the environment key as a bearer token", async () => {
		const calls = stubFetch(() => envelope(wireData));

		await client().extract({
			url: "https://cdn.test/invoice.pdf",
			filename: "invoice.pdf",
			schema: invoiceSchema,
		});

		expect(calls).toHaveLength(1);
		expect(calls[0]?.url).toBe(EXTRACT_URL);
		expect(calls[0]?.method).toBe("POST");
		expect(calls[0]?.headers.authorization).toBe("Bearer wwk_test");
		expect(calls[0]?.headers["content-type"]).toContain("application/json");
	});

	test("joins a trailing-slash apiUrl without doubling the separator", async () => {
		const calls = stubFetch(() => envelope(wireData));

		await client({ apiUrl: "https://example.test/" }).extract({
			url: "https://cdn.test/invoice.pdf",
			filename: "invoice.pdf",
			schema: invoiceSchema,
		});

		expect(calls[0]?.url).toBe(EXTRACT_URL);
	});

	test("honours a self-hosted apiUrl", async () => {
		const calls = stubFetch(() => envelope(wireData));

		await client({ apiUrl: "https://eu.app.waniwani.ai" }).extract({
			url: "https://cdn.test/invoice.pdf",
			filename: "invoice.pdf",
			schema: invoiceSchema,
		});

		expect(calls[0]?.url).toBe(
			"https://eu.app.waniwani.ai/api/mcp/modules/documents/extract",
		);
	});

	test("sends the document url and filename verbatim", async () => {
		const calls = stubFetch(() => envelope(wireData));

		await client().extract({
			url: "https://cdn.test/a%20b/invoice.pdf?sig=abc",
			filename: "Facture été.pdf",
			schema: invoiceSchema,
		});

		expect(calls[0]?.body.url).toBe(
			"https://cdn.test/a%20b/invoice.pdf?sig=abc",
		);
		expect(calls[0]?.body.filename).toBe("Facture été.pdf");
	});

	test("sends the caller's schema as JSON Schema produced by z.toJSONSchema", async () => {
		const calls = stubFetch(() => envelope(wireData));

		await client().extract({
			url: "https://cdn.test/invoice.pdf",
			filename: "invoice.pdf",
			schema: invoiceSchema,
		});

		expect(calls[0]?.body.schema).toEqual(z.toJSONSchema(invoiceSchema));
	});

	test("a nullable field crosses the wire as a null-permitting JSON Schema", async () => {
		const calls = stubFetch(() => envelope(wireData));

		await client().extract({
			url: "https://cdn.test/invoice.pdf",
			filename: "invoice.pdf",
			schema: invoiceSchema,
		});

		expect(JSON.stringify(calls[0]?.body.schema)).toContain(
			'"dueDate":{"anyOf":[{"type":"string"},{"type":"null"}]}',
		);
	});
});

describe("documents.extract — page selection", () => {
	test("sends zero-based page indexes verbatim, including out-of-range ones", async () => {
		const calls = stubFetch(() => envelope(wireData));

		await client().extract({
			url: "https://cdn.test/invoice.pdf",
			filename: "invoice.pdf",
			schema: invoiceSchema,
			pages: [0, 2, 999],
		});

		expect(calls[0]?.body.pages).toEqual([0, 2, 999]);
	});

	test("asking for only the first page sends index 0, not index 1", async () => {
		const calls = stubFetch(() => envelope(wireData));

		await client().extract({
			url: "https://cdn.test/invoice.pdf",
			filename: "invoice.pdf",
			schema: invoiceSchema,
			pages: [0],
		});

		expect(calls[0]?.body.pages).toEqual([0]);
	});

	test("omits pages from the body when the caller selects none", async () => {
		const calls = stubFetch(() => envelope(wireData));

		await client().extract({
			url: "https://cdn.test/invoice.pdf",
			filename: "invoice.pdf",
			schema: invoiceSchema,
		});

		expect(calls[0]?.body).not.toHaveProperty("pages");
	});
});

describe("documents.extract — response", () => {
	test("returns the envelope's data fields", async () => {
		stubFetch(() => envelope(wireData));

		const result = await client().extract({
			url: "https://cdn.test/invoice.pdf",
			filename: "invoice.pdf",
			schema: invoiceSchema,
		});

		expect(result.pageCount).toBe(3);
		expect(result.pageConfidence).toBe(0.94);
		expect(result.documentId).toBe("doc_123");
		expect(result.fields).toEqual({
			invoiceNumber: "INV-1",
			total: 42.5,
			dueDate: null,
		});
	});

	test("a nullable field the document did not answer comes back as null", async () => {
		stubFetch(() =>
			envelope({ ...wireData, fields: { ...wireData.fields, dueDate: null } }),
		);

		const result = await client().extract({
			url: "https://cdn.test/invoice.pdf",
			filename: "invoice.pdf",
			schema: invoiceSchema,
		});

		expect(result.fields.dueDate).toBeNull();
	});

	test("re-parses fields with the caller's schema, dropping keys it does not declare", async () => {
		stubFetch(() =>
			envelope({
				...wireData,
				fields: { ...wireData.fields, _internalDebug: "leaked" },
			}),
		);

		const result = await client().extract({
			url: "https://cdn.test/invoice.pdf",
			filename: "invoice.pdf",
			schema: invoiceSchema,
		});

		expect(result.fields).not.toHaveProperty("_internalDebug");
	});

	test("rejects when the platform's fields do not satisfy the caller's schema", async () => {
		stubFetch(() =>
			envelope({
				...wireData,
				fields: { invoiceNumber: "INV-1", total: "42.5" },
			}),
		);

		await expect(
			client().extract({
				url: "https://cdn.test/invoice.pdf",
				filename: "invoice.pdf",
				schema: invoiceSchema,
			}),
		).rejects.toThrow();
	});

	test("a null pageConfidence survives as null", async () => {
		stubFetch(() => envelope({ ...wireData, pageConfidence: null }));

		const result = await client().extract({
			url: "https://cdn.test/invoice.pdf",
			filename: "invoice.pdf",
			schema: invoiceSchema,
		});

		expect(result.pageConfidence).toBeNull();
	});

	test("a missing pageConfidence surfaces as null, never undefined", async () => {
		stubFetch(() =>
			envelope({
				fields: wireData.fields,
				pageCount: 1,
				documentId: "doc_123",
			}),
		);

		const result = await client().extract({
			url: "https://cdn.test/invoice.pdf",
			filename: "invoice.pdf",
			schema: invoiceSchema,
		});

		expect(result.pageConfidence).toBeNull();
	});
});

describe("documents.extract — failures", () => {
	test("a non-2xx response surfaces as WaniWaniError carrying the status", async () => {
		stubFetch(() => new Response("file too large", { status: 413 }));

		const promise = client().extract({
			url: "https://cdn.test/invoice.pdf",
			filename: "invoice.pdf",
			schema: invoiceSchema,
		});

		await expect(promise).rejects.toBeInstanceOf(WaniWaniError);
		await promise.catch((error: unknown) => {
			expect(error).toBeInstanceOf(WaniWaniError);
			if (error instanceof WaniWaniError) {
				expect(error.status).toBe(413);
				expect(error.message).toContain("file too large");
			}
		});
	});

	test("a non-2xx response with an empty body still carries the status", async () => {
		stubFetch(() => new Response("", { status: 502 }));

		await client()
			.extract({
				url: "https://cdn.test/invoice.pdf",
				filename: "invoice.pdf",
				schema: invoiceSchema,
			})
			.catch((error: unknown) => {
				expect(error).toBeInstanceOf(WaniWaniError);
				if (error instanceof WaniWaniError) {
					expect(error.status).toBe(502);
					expect(error.message).toContain("502");
				}
			});
	});

	test("a non-2xx envelope surfaces its message, not the raw JSON body", async () => {
		stubFetch(
			() =>
				new Response(
					JSON.stringify({
						success: false,
						message: "Private and loopback addresses are refused",
						data: null,
					}),
					{ status: 400, headers: { "content-type": "application/json" } },
				),
		);

		await client()
			.extract({
				url: "http://127.0.0.1/invoice.pdf",
				filename: "invoice.pdf",
				schema: invoiceSchema,
			})
			.catch((error: unknown) => {
				expect(error).toBeInstanceOf(WaniWaniError);
				if (error instanceof WaniWaniError) {
					expect(error.status).toBe(400);
					expect(error.message).toBe(
						"Private and loopback addresses are refused",
					);
				}
			});
	});

	test("throws before issuing a request when no API key is configured", async () => {
		const calls = stubFetch(() => envelope(wireData));

		await expect(
			client({ apiKey: undefined }).extract({
				url: "https://cdn.test/invoice.pdf",
				filename: "invoice.pdf",
				schema: invoiceSchema,
			}),
		).rejects.toThrow("WANIWANI_API_KEY is not set");
		expect(calls).toHaveLength(0);
	});
});

// zod is an optional peer dependency (package.json peerDependenciesMeta), so
// `import "@waniwani/sdk"` must keep working for a consumer who has not
// installed it.
describe("core path stays free of the optional zod peer", () => {
	test("no module reachable from src/index.ts value-imports zod", () => {
		const entry = resolve(import.meta.dir, "..", "index.ts");
		const seen = new Set<string>();
		const offenders: string[] = [];

		const STATEMENT =
			/^[ \t]*(?:import|export)[ \t]+(type[ \t]+)?([^;]*?)from[ \t]*["']([^"']+)["']/gm;

		const retainedSpecifiers = (source: string): string[] => {
			const out: string[] = [];
			for (const match of source.matchAll(STATEMENT)) {
				if (match[1]) {
					continue;
				}
				const spec = match[3];
				if (spec) {
					out.push(spec);
				}
			}
			return out;
		};

		const walk = (file: string): void => {
			if (seen.has(file)) {
				return;
			}
			seen.add(file);
			let source: string;
			try {
				source = readFileSync(file, "utf-8");
			} catch {
				return;
			}
			const specifiers = retainedSpecifiers(source);
			if (specifiers.includes("zod")) {
				offenders.push(file.slice(file.indexOf("/src/") + 1));
			}
			for (const spec of specifiers) {
				if (!spec.startsWith(".")) {
					continue;
				}
				const base = resolve(dirname(file), spec.replace(/\.js$/, ""));
				for (const candidate of [`${base}.ts`, `${base}/index.ts`]) {
					try {
						readFileSync(candidate, "utf-8");
						walk(candidate);
						break;
					} catch {}
				}
			}
		};

		walk(entry);

		expect(offenders).toEqual([]);
	});
});

describe("documents.extract — the stored-document branch", () => {
	test("sends the id alone: no url, no filename, not even as undefined", async () => {
		const calls = stubFetch(() => envelope(wireData));

		await client().extract({
			documentId: "doc_upload_1",
			schema: invoiceSchema,
		});

		expect(calls[0]?.body.documentId).toBe("doc_upload_1");
		expect(calls[0]?.body).not.toHaveProperty("url");
		expect(calls[0]?.body).not.toHaveProperty("filename");
	});

	test("the url branch still travels without a documentId", async () => {
		const calls = stubFetch(() => envelope(wireData));

		await client().extract({
			url: "https://cdn.test/invoice.pdf",
			filename: "invoice.pdf",
			schema: invoiceSchema,
		});

		expect(calls[0]?.body).not.toHaveProperty("documentId");
		expect(calls[0]?.body.url).toBe("https://cdn.test/invoice.pdf");
	});

	test("an attached document spread whole leaks neither its filename nor its media type", async () => {
		const calls = stubFetch(() => envelope(wireData));
		const attached = {
			documentId: "doc_upload_1",
			filename: "passport-scan.png",
			mediaType: "image/png",
		};

		await client().extract({ ...attached, schema: invoiceSchema });

		expect(calls[0]?.body.documentId).toBe("doc_upload_1");
		expect(calls[0]?.body).not.toHaveProperty("filename");
		expect(calls[0]?.body).not.toHaveProperty("mediaType");
	});

	test("page selection, session and correlation ids ride along on a stored call", async () => {
		const calls = stubFetch(() => envelope(wireData));

		await client().extract({
			documentId: "doc_upload_1",
			schema: invoiceSchema,
			pages: [0, 1],
			sessionId: "sess_1",
			correlationId: "corr_1",
		});

		expect(calls[0]?.body.pages).toEqual([0, 1]);
		expect(calls[0]?.body.sessionId).toBe("sess_1");
		expect(calls[0]?.body.correlationId).toBe("corr_1");
	});

	test("the platform's refusal for a stored id surfaces its code and detail", async () => {
		stubFetch(
			() =>
				new Response(
					JSON.stringify({
						message: "DOCUMENT_NOT_FOUND",
						detail: "doc_upload_1 has passed its retention window",
					}),
					{ status: 404, headers: { "content-type": "application/json" } },
				),
		);

		await client()
			.extract({ documentId: "doc_upload_1", schema: invoiceSchema })
			.catch((error: unknown) => {
				expect(error).toBeInstanceOf(WaniWaniError);
				if (error instanceof WaniWaniError) {
					expect(error.status).toBe(404);
					expect(error.message).toBe(
						"DOCUMENT_NOT_FOUND: doc_upload_1 has passed its retention window",
					);
				}
			});
	});
});
