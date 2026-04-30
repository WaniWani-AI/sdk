// WaniWani SDK - Express Adapter

import { Readable } from "node:stream";
import type { WaniWaniClient } from "../../../types.js";
import { createApiHandler } from "../api-handler.js";
import type {
	ExpressJsHandlerOptions,
	ExpressJsHandlerResult,
	ExpressLikeRequest,
	ExpressLikeResponse,
} from "./@types.js";

export type {
	ChatOptions,
	ExpressJsHandlerOptions,
	ExpressJsHandlerResult,
	ExpressLikeRequest,
	ExpressLikeResponse,
	ExpressMiddleware,
} from "./@types.js";

/**
 * Create Express middleware from a WaniWani client.
 *
 * Returns `{ get, post, patch, options }` — each is an Express-compatible
 * middleware (`(req, res, next) => void`). Mount on a router/path of your choice:
 *
 * ```ts
 * import express from "express";
 * import { waniwani } from "@waniwani/sdk";
 * import { toExpressJsHandler } from "@waniwani/sdk/express-js";
 *
 * const wani = waniwani();
 * const handler = toExpressJsHandler(wani, {
 *   source: "my-app",
 *   chat: { mcpServerUrl: process.env.MCP_SERVER_URL },
 * });
 *
 * const app = express();
 * // IMPORTANT: do NOT use express.json() on these routes — the adapter reads
 * // the raw request body stream itself.
 * app.get("/api/waniwani/*", handler.get);
 * app.post("/api/waniwani", handler.post);
 * app.patch("/api/waniwani/*", handler.patch);
 * app.options("/api/waniwani/*", handler.options);
 * ```
 */
export function toExpressJsHandler(
	client: WaniWaniClient,
	options: ExpressJsHandlerOptions,
): ExpressJsHandlerResult {
	const { apiKey, apiUrl } = client._config;
	const debugEnabled = options?.debug ?? process.env.WANIWANI_DEBUG === "1";

	const handler = createApiHandler({
		...options?.chat,
		apiKey,
		apiUrl,
		source: options?.source,
		debug: debugEnabled,
	});

	return {
		get: (req, res, next) => adapt(handler.routeGet, req, res, next),
		post: (req, res, next) => adapt(handler.routePost, req, res, next),
		patch: (req, res, next) => adapt(handler.routePatch, req, res, next),
		options: (_req, res) => {
			void sendWebResponse(handler.handleOptions(), res).catch((err) => {
				console.error("[waniwani:express] OPTIONS handler error:", err);
			});
		},
	};
}

async function adapt(
	fn: (request: Request) => Promise<Response>,
	req: ExpressLikeRequest,
	res: ExpressLikeResponse,
	next: (err?: unknown) => void,
): Promise<void> {
	try {
		const webRequest = expressToWebRequest(req);
		const webResponse = await fn(webRequest);
		await sendWebResponse(webResponse, res);
	} catch (err) {
		next(err);
	}
}

/**
 * Build a Web `Request` from an Express request, preserving method, headers,
 * URL, and body stream. Body is exposed as a `ReadableStream` so the underlying
 * handlers can call `await request.text()` / `.json()` / pipe through.
 */
export function expressToWebRequest(req: ExpressLikeRequest): Request {
	const protocol =
		req.protocol ??
		(typeof req.get === "function"
			? req.get("x-forwarded-proto")
			: undefined) ??
		"http";
	const host =
		(typeof req.get === "function"
			? req.get("host")
			: (req.headers.host as string | undefined)) ?? "localhost";
	const path = req.originalUrl ?? req.url;
	const url = new URL(path, `${protocol}://${host}`).toString();

	const headers = new Headers();
	for (const [key, value] of Object.entries(req.headers)) {
		if (value === undefined) {
			continue;
		}
		if (Array.isArray(value)) {
			for (const v of value) {
				headers.append(key, v);
			}
		} else {
			headers.set(key, value);
		}
	}

	const init: RequestInit = { method: req.method, headers };

	const method = req.method.toUpperCase();
	if (method !== "GET" && method !== "HEAD") {
		// Convert Node Readable → Web ReadableStream so fetch's Request can
		// consume it. Cast to Node Readable: ExpressLikeRequest's `on` matches.
		const nodeStream = req as unknown as Readable;
		init.body = Readable.toWeb(
			nodeStream,
		) as unknown as ReadableStream<Uint8Array>;
		// Fetch spec requires duplex: 'half' when sending a streaming body.
		(init as RequestInit & { duplex: "half" }).duplex = "half";
	}

	return new Request(url, init);
}

/**
 * Pipe a Web `Response` to an Express response. Status, headers, and body
 * (including streaming bodies) are forwarded. Resolves once the body has been
 * fully written and the response ended.
 */
export async function sendWebResponse(
	webRes: Response,
	res: ExpressLikeResponse,
): Promise<void> {
	res.statusCode = webRes.status;
	webRes.headers.forEach((value, key) => {
		res.setHeader(key, value);
	});

	if (!webRes.body) {
		res.end();
		return;
	}

	const nodeReadable = Readable.fromWeb(
		webRes.body as unknown as import("node:stream/web").ReadableStream<Uint8Array>,
	);

	await new Promise<void>((resolve, reject) => {
		nodeReadable.on("data", (chunk: Uint8Array | Buffer | string) => {
			res.write(chunk);
		});
		nodeReadable.on("end", () => {
			res.end();
			resolve();
		});
		nodeReadable.on("error", (err) => {
			reject(err);
		});
	});
}
