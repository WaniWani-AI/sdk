import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	DocumentUploadError,
	uploadDocument,
	uploadUrlEndpoint,
} from "../document-upload";

const API = "https://app.waniwani.ai/api/mcp/chat";

interface ProgressEventLike {
	lengthComputable: boolean;
	loaded: number;
	total: number;
}

class FakeXhr {
	static instances: FakeXhr[] = [];

	status = 0;
	aborted = false;
	method = "";
	url = "";
	headers: Record<string, string> = {};
	body: unknown;
	readonly upload: { onprogress?: (event: ProgressEventLike) => void } = {};
	timeout = 0;
	onload: (() => void) | null = null;
	onerror: (() => void) | null = null;
	onabort: (() => void) | null = null;
	ontimeout: (() => void) | null = null;

	constructor() {
		FakeXhr.instances.push(this);
	}

	open(method: string, url: string) {
		this.method = method;
		this.url = url;
	}

	setRequestHeader(key: string, value: string) {
		this.headers[key] = value;
	}

	send(body: unknown) {
		this.body = body;
	}

	abort() {
		this.aborted = true;
		this.onabort?.();
	}

	emitProgress(loaded: number, total: number) {
		this.upload.onprogress?.({ lengthComputable: true, loaded, total });
	}

	finish(status: number) {
		this.status = status;
		this.onload?.();
	}

	networkError() {
		this.onerror?.();
	}

	timeout_() {
		this.ontimeout?.();
	}
}

interface MintCall {
	url: string;
	method: string | undefined;
	headers: Record<string, string>;
	body: Record<string, unknown>;
}

let mintCalls: MintCall[] = [];
let mintResponse: () => Response | Promise<Response>;

const originalFetch = globalThis.fetch;
// biome-ignore lint/suspicious/noExplicitAny: swapping the browser globals for stubs
const originalXhr = (globalThis as any).XMLHttpRequest;

beforeEach(() => {
	mintCalls = [];
	FakeXhr.instances = [];
	mintResponse = () =>
		Response.json({
			success: true,
			data: {
				documentId: "doc_1",
				uploadUrl: "https://storage.test/put/doc_1?sig=abc",
				headers: { "Content-Type": "application/pdf" },
			},
		});

	globalThis.fetch = Object.assign(
		async (input: unknown, init?: RequestInit) => {
			const headers: Record<string, string> = {};
			new Headers(init?.headers).forEach((value, key) => {
				headers[key] = value;
			});
			mintCalls.push({
				url: String(input),
				method: init?.method,
				headers,
				body: typeof init?.body === "string" ? JSON.parse(init.body) : {},
			});
			if (init?.signal?.aborted) {
				throw init.signal.reason;
			}
			return await mintResponse();
		},
		{ preconnect: () => {} },
	) as unknown as typeof fetch;

	// biome-ignore lint/suspicious/noExplicitAny: swapping the browser global for a stub
	(globalThis as any).XMLHttpRequest = FakeXhr;
});

afterEach(() => {
	globalThis.fetch = originalFetch;
	// biome-ignore lint/suspicious/noExplicitAny: swapping the browser globals for stubs
	(globalThis as any).XMLHttpRequest = originalXhr;
});

function pdf(name = "policy.pdf", bytes = 12) {
	return new File(["x".repeat(bytes)], name, { type: "application/pdf" });
}

/** Lets the mint leg's promise chain reach `putBytes` before the test drives the XHR. */
async function xhr(): Promise<FakeXhr> {
	for (let attempt = 0; attempt < 50; attempt += 1) {
		const instance = FakeXhr.instances[0];
		if (instance) {
			return instance;
		}
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
	throw new Error("no XHR was opened");
}

function upload(overrides?: Partial<Parameters<typeof uploadDocument>[0]>) {
	return uploadDocument({
		file: pdf(),
		api: API,
		headers: { Authorization: "Bearer wwp_test" },
		signal: new AbortController().signal,
		...overrides,
	});
}

describe("uploadUrlEndpoint", () => {
	test("derives the mint endpoint from an absolute chat api", () => {
		expect(uploadUrlEndpoint(API)).toBe(
			"https://app.waniwani.ai/api/mcp/modules/documents/upload-url",
		);
	});

	test("honours a self-hosted origin", () => {
		expect(uploadUrlEndpoint("https://eu.app.waniwani.ai/api/mcp/chat")).toBe(
			"https://eu.app.waniwani.ai/api/mcp/modules/documents/upload-url",
		);
	});

	test("a root-relative api falls back to the module path, for the page to resolve", () => {
		expect(uploadUrlEndpoint("/api/mcp/chat")).toBe(
			"/api/mcp/modules/documents/upload-url",
		);
	});

	test("never resolves to the chat endpoint itself, whatever the api is named", () => {
		for (const api of [
			"/api/waniwani",
			"/api/waniwani/",
			"/chat",
			"/api/agent/messages",
			"",
			"https://app.waniwani.ai/api/mcp/chat?test=1",
		]) {
			expect(uploadUrlEndpoint(api)).toContain(
				"/api/mcp/modules/documents/upload-url",
			);
		}
	});

	test("an api it cannot parse still names the module, never the chat route", () => {
		for (const api of ["", "   ", "not a url", "://nope"]) {
			expect(uploadUrlEndpoint(api)).toBe(
				"/api/mcp/modules/documents/upload-url",
			);
		}
	});
});

describe("uploadDocument — minting the url", () => {
	test("POSTs the file's identity to the platform, then PUTs the bytes", async () => {
		const pending = upload({
			file: pdf("policy.pdf", 2048),
			sessionId: "sess_1",
		});
		const request = await xhr();
		request.finish(200);

		await expect(pending).resolves.toEqual({
			documentId: "doc_1",
			filename: "policy.pdf",
			mediaType: "application/pdf",
		});

		expect(mintCalls).toHaveLength(1);
		expect(mintCalls[0]?.method).toBe("POST");
		expect(mintCalls[0]?.url).toBe(
			"https://app.waniwani.ai/api/mcp/modules/documents/upload-url",
		);
		expect(mintCalls[0]?.headers.authorization).toBe("Bearer wwp_test");
		expect(mintCalls[0]?.headers["content-type"]).toContain("application/json");
		expect(mintCalls[0]?.body).toEqual({
			filename: "policy.pdf",
			contentType: "application/pdf",
			byteSize: 2048,
			sessionId: "sess_1",
		});
	});

	test("omits sessionId before the first turn has one", async () => {
		const pending = upload();
		(await xhr()).finish(200);
		await pending;

		expect(mintCalls[0]?.body).not.toHaveProperty("sessionId");
	});

	test("PUTs to the minted url with the minted headers and the file itself", async () => {
		const file = pdf("policy.pdf");
		const pending = upload({ file });
		const request = await xhr();
		request.finish(200);
		await pending;

		expect(request.method).toBe("PUT");
		expect(request.url).toBe("https://storage.test/put/doc_1?sig=abc");
		expect(request.headers["Content-Type"]).toBe("application/pdf");
		expect(request.body).toBe(file);
	});

	test("the visitor's bearer token never reaches object storage", async () => {
		const pending = upload();
		const request = await xhr();
		request.finish(200);
		await pending;

		expect(Object.keys(request.headers)).not.toContain("Authorization");
	});
});

describe("uploadDocument — the platform's refusals map onto codes", () => {
	const cases: Array<[number, string]> = [
		[403, "upload_disabled"],
		[413, "max_file_size"],
		[422, "accept"],
		[400, "accept"],
		[500, "upload_failed"],
		[404, "upload_failed"],
		[502, "upload_failed"],
	];

	for (const [status, code] of cases) {
		test(`HTTP ${status} surfaces as ${code}`, async () => {
			mintResponse = () => new Response("nope", { status });

			const error = await upload().catch((e: unknown) => e);

			expect(error).toBeInstanceOf(DocumentUploadError);
			expect((error as DocumentUploadError).code).toBe(code);
			expect((error as DocumentUploadError).message.length).toBeGreaterThan(0);
			expect(FakeXhr.instances).toHaveLength(0);
		});
	}

	test("a refused mint never sends the bytes", async () => {
		mintResponse = () => new Response("nope", { status: 413 });

		await upload().catch(() => {});

		expect(FakeXhr.instances).toHaveLength(0);
	});
});

describe("uploadDocument — a mint the widget cannot use", () => {
	const unusable: Array<[string, () => Response]> = [
		[
			"a non-JSON body",
			() => new Response("<html>502</html>", { status: 200 }),
		],
		["an empty body", () => new Response("", { status: 200 })],
		["null data", () => Response.json({ success: true, data: null })],
		[
			"data without a documentId",
			() =>
				Response.json({
					success: true,
					data: { uploadUrl: "https://storage.test/put" },
				}),
		],
		[
			"data without an uploadUrl",
			() => Response.json({ success: true, data: { documentId: "doc_1" } }),
		],
		[
			"an empty documentId",
			() =>
				Response.json({
					success: true,
					data: { documentId: "", uploadUrl: "https://storage.test/put" },
				}),
		],
	];

	for (const [label, response] of unusable) {
		test(`${label} fails as upload_failed without sending bytes`, async () => {
			mintResponse = response;

			const error = await upload().catch((e: unknown) => e);

			expect(error).toBeInstanceOf(DocumentUploadError);
			expect((error as DocumentUploadError).code).toBe("upload_failed");
			expect(FakeXhr.instances).toHaveLength(0);
		});
	}

	test("a mint with no headers still PUTs the bytes", async () => {
		mintResponse = () =>
			Response.json({
				success: true,
				data: {
					documentId: "doc_1",
					uploadUrl: "https://storage.test/put/doc_1",
				},
			});

		const pending = upload();
		(await xhr()).finish(200);

		await expect(pending).resolves.toMatchObject({ documentId: "doc_1" });
	});
});

describe("uploadDocument — the storage leg", () => {
	test("reports progress as a fraction and lands on 1", async () => {
		const seen: number[] = [];
		const pending = upload({ onProgress: (n) => seen.push(n) });
		const request = await xhr();
		request.emitProgress(512, 2048);
		request.emitProgress(2048, 2048);
		request.finish(204);
		await pending;

		expect(seen[0]).toBeCloseTo(0.25);
		expect(seen.at(-1)).toBe(1);
	});

	test("ignores a progress event with no computable total", async () => {
		const seen: number[] = [];
		const pending = upload({ onProgress: (n) => seen.push(n) });
		const request = await xhr();
		request.upload.onprogress?.({
			lengthComputable: false,
			loaded: 10,
			total: 0,
		});
		request.finish(200);
		await pending;

		expect(seen).toEqual([1]);
	});

	test("storage refusing the PUT surfaces as upload_failed", async () => {
		const pending = upload();
		const error = pending.catch((e: unknown) => e);
		(await xhr()).finish(403);

		expect(await error).toBeInstanceOf(DocumentUploadError);
		expect(((await error) as DocumentUploadError).code).toBe("upload_failed");
	});

	test("a dropped connection during the PUT surfaces as upload_failed", async () => {
		const pending = upload();
		const error = pending.catch((e: unknown) => e);
		(await xhr()).networkError();

		expect(((await error) as DocumentUploadError).code).toBe("upload_failed");
	});
});

describe("uploadDocument — abort", () => {
	test("aborting mid-PUT aborts the request and rejects with the caller's reason", async () => {
		const controller = new AbortController();
		const reason = new Error("removed by the visitor");
		const pending = upload({ signal: controller.signal });
		const error = pending.catch((e: unknown) => e);
		const request = await xhr();

		controller.abort(reason);

		expect(request.aborted).toBe(true);
		expect(await error).toBe(reason);
	});

	test("a signal already aborted before the call sends nothing at all", async () => {
		const controller = new AbortController();
		controller.abort(new Error("removed by the visitor"));

		await Promise.race([
			upload({ signal: controller.signal }).catch(() => {}),
			new Promise((resolve) => setTimeout(resolve, 50)),
		]);

		expect(mintCalls).toHaveLength(0);
		expect(FakeXhr.instances).toHaveLength(0);
	});

	test("aborting mid-mint leaves the caller's reason intact, not a DocumentUploadError", async () => {
		const controller = new AbortController();
		const reason = new Error("removed by the visitor");
		mintResponse = () =>
			new Promise((_resolve, reject) => {
				controller.signal.addEventListener(
					"abort",
					() => reject(controller.signal.reason),
					{ once: true },
				);
			});

		const pending = upload({ signal: controller.signal });
		const error = pending.catch((e: unknown) => e);
		await new Promise((resolve) => setTimeout(resolve, 0));
		controller.abort(reason);

		expect(await error).toBe(reason);
	});

	test("a mint that never reaches the platform surfaces as upload_failed", async () => {
		mintResponse = () => {
			throw new TypeError("Failed to fetch");
		};

		const error = await upload().catch((e: unknown) => e);

		expect(error).toBeInstanceOf(DocumentUploadError);
		expect((error as DocumentUploadError).code).toBe("upload_failed");
	});
});

describe("uploadDocument — a leg that never answers", () => {
	test("the PUT carries a timeout so a stalled upload does not hang the composer", async () => {
		const pending = upload();
		const request = await xhr();
		request.finish(200);
		await pending;

		expect(request.timeout).toBeGreaterThan(0);
	});

	test("a timed-out PUT surfaces as upload_failed", async () => {
		const pending = upload();
		const error = pending.catch((e: unknown) => e);
		(await xhr()).timeout_();

		expect(await error).toBeInstanceOf(DocumentUploadError);
		expect(((await error) as DocumentUploadError).code).toBe("upload_failed");
	});
});
