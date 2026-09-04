/**
 * Two legs: the platform mints a one-shot presigned URL, then the browser PUTs
 * the bytes straight to object storage, so a 20 MB scan never crosses a
 * function's request-body cap.
 */

import type { AttachedDocument } from "../../../documents/types";

const DOCUMENTS_PATH = "/api/mcp/modules/documents";

/** Minting is a small JSON call, so a slow one is a broken one. */
const MINT_TIMEOUT_MS = 20_000;

/** The presigned URL dies before this, so a PUT still running has nothing left to succeed against. */
const PUT_TIMEOUT_MS = 300_000;

export type DocumentUploadFailure =
	| "upload_disabled"
	| "max_file_size"
	| "accept"
	| "upload_failed";

export class DocumentUploadError extends Error {
	readonly code: DocumentUploadFailure;

	constructor(code: DocumentUploadFailure, message: string) {
		super(message);
		this.name = "DocumentUploadError";
		this.code = code;
	}
}

/** Derives a module endpoint from the chat `api` base, which may be absolute or root-relative. */
function documentsEndpoint(api: string, path: string): string {
	try {
		return `${new URL(api).origin}${DOCUMENTS_PATH}${path}`;
	} catch {
		return `${DOCUMENTS_PATH}${path}`;
	}
}

export function uploadUrlEndpoint(api: string): string {
	return documentsEndpoint(api, "/upload-url");
}

/** `Headers.set` is what makes a differently-cased override actually override. */
function requestHeaders(
	headers: Record<string, string> | undefined,
	overrides: Record<string, string> | undefined,
): Headers {
	const merged = new Headers(headers);
	new Headers(overrides).forEach((value, name) => {
		merged.set(name, value);
	});
	return merged;
}

interface MintedUpload {
	documentId: string;
	uploadUrl: string;
	headers: Record<string, string>;
}

function readMinted(value: unknown): MintedUpload | null {
	const payload = (value as { data?: Partial<MintedUpload> })?.data;
	if (
		typeof payload?.documentId !== "string" ||
		typeof payload.uploadUrl !== "string" ||
		!(payload.documentId && payload.uploadUrl)
	) {
		return null;
	}

	const headers: Record<string, string> = {};
	for (const [key, header] of Object.entries(payload.headers ?? {})) {
		if (typeof header === "string") {
			headers[key] = header;
		}
	}

	return {
		documentId: payload.documentId,
		uploadUrl: payload.uploadUrl,
		headers,
	};
}

function failureFor(status: number): DocumentUploadError {
	if (status === 403) {
		return new DocumentUploadError(
			"upload_disabled",
			"This agent does not accept document uploads.",
		);
	}
	if (status === 413) {
		return new DocumentUploadError("max_file_size", "That file is too large.");
	}
	if (status === 422 || status === 400) {
		return new DocumentUploadError("accept", "That file type is not accepted.");
	}
	return new DocumentUploadError(
		"upload_failed",
		`The upload could not be started (${status}).`,
	);
}

/** XHR is the only browser API that reports how much of a request body has gone out. */
function putBytes(input: {
	url: string;
	headers: Record<string, string>;
	file: File;
	signal: AbortSignal;
	onProgress?: (fraction: number) => void;
}): Promise<void> {
	return new Promise((resolve, reject) => {
		const request = new XMLHttpRequest();
		request.open("PUT", input.url, true);
		for (const [key, value] of Object.entries(input.headers)) {
			request.setRequestHeader(key, value);
		}

		request.timeout = PUT_TIMEOUT_MS;

		const abort = () => request.abort();
		input.signal.addEventListener("abort", abort, { once: true });
		const settle = () => input.signal.removeEventListener("abort", abort);

		request.upload.onprogress = (event) => {
			if (event.lengthComputable && event.total > 0) {
				input.onProgress?.(event.loaded / event.total);
			}
		};
		request.onload = () => {
			settle();
			// 412 is the write-once precondition: the key already holds these bytes,
			// and only this client was ever given it. A retry after a lost response
			// lands here, and the document is there either way.
			if (
				(request.status >= 200 && request.status < 300) ||
				request.status === 412
			) {
				input.onProgress?.(1);
				resolve();
				return;
			}
			reject(
				new DocumentUploadError(
					"upload_failed",
					`The upload was rejected (${request.status}).`,
				),
			);
		};
		request.onerror = () => {
			settle();
			reject(
				new DocumentUploadError(
					"upload_failed",
					"The upload could not be completed.",
				),
			);
		};
		request.ontimeout = () => {
			settle();
			reject(new DocumentUploadError("upload_failed", "The upload timed out."));
		};
		request.onabort = () => {
			settle();
			reject(
				input.signal.reason instanceof Error
					? input.signal.reason
					: new Error("aborted"),
			);
		};

		request.send(input.file);
	});
}

/** Best effort: the seven-day lifecycle rule is what guarantees the object goes. */
export async function discardDocument(input: {
	documentId: string;
	api: string;
	headers?: Record<string, string>;
	uploadHeaders?: Record<string, string>;
}): Promise<void> {
	try {
		await fetch(documentsEndpoint(input.api, `/${input.documentId}`), {
			method: "DELETE",
			headers: requestHeaders(input.headers, input.uploadHeaders),
		});
	} catch {
		// Nothing the visitor can do about it, and the lifecycle rule still applies.
	}
}

export async function uploadDocument(input: {
	file: File;
	api: string;
	headers?: Record<string, string>;
	uploadHeaders?: Record<string, string>;
	sessionId?: string;
	signal: AbortSignal;
	onProgress?: (fraction: number) => void;
}): Promise<AttachedDocument> {
	input.signal.throwIfAborted();

	const mint = new AbortController();
	const giveUp = setTimeout(() => mint.abort(), MINT_TIMEOUT_MS);
	const passOn = () => mint.abort(input.signal.reason);
	input.signal.addEventListener("abort", passOn, { once: true });

	let response: Response;
	try {
		const mintHeaders = requestHeaders(input.headers, input.uploadHeaders);
		mintHeaders.set("Content-Type", "application/json");
		response = await fetch(uploadUrlEndpoint(input.api), {
			method: "POST",
			headers: mintHeaders,
			signal: mint.signal,
			body: JSON.stringify({
				filename: input.file.name,
				contentType: input.file.type,
				byteSize: input.file.size,
				...(input.sessionId ? { sessionId: input.sessionId } : {}),
			}),
		});
	} catch (error) {
		if (input.signal.aborted) {
			throw error;
		}
		throw new DocumentUploadError(
			"upload_failed",
			"The upload could not be started.",
		);
	} finally {
		clearTimeout(giveUp);
		input.signal.removeEventListener("abort", passOn);
	}

	if (!response.ok) {
		throw failureFor(response.status);
	}

	const minted = readMinted(await response.json().catch(() => null));
	input.signal.throwIfAborted();
	if (!minted) {
		throw new DocumentUploadError(
			"upload_failed",
			"The upload could not be started.",
		);
	}

	await putBytes({
		url: minted.uploadUrl,
		headers: minted.headers,
		file: input.file,
		signal: input.signal,
		onProgress: input.onProgress,
	});

	return {
		documentId: minted.documentId,
		filename: input.file.name,
		mediaType: input.file.type,
	};
}
