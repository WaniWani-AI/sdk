import type {
	ToolCalledProperties,
	TrackInput,
} from "../../../tracking/index.js";
import type { WaniWaniClient } from "../../../types.js";
import { extractSessionId, extractSource } from "../utils.js";
import type { WidgetTokenCache } from "../widget-token.js";

type UnknownRecord = Record<string, unknown>;

export type WaniwaniTracker = Pick<
	WaniWaniClient,
	"flush" | "track" | "identify" | "kb" | "_config"
>;

const SESSION_ID_KEY = "waniwani/sessionId";
const GEO_LOCATION_KEY = "waniwani/geoLocation";
const LEGACY_USER_LOCATION_KEY = "waniwani/userLocation";

export function isRecord(value: unknown): value is UnknownRecord {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function extractMeta(extra: unknown): UnknownRecord | undefined {
	if (!isRecord(extra)) {
		return undefined;
	}
	const meta = extra._meta;
	return isRecord(meta) ? meta : undefined;
}

export function extractErrorText(result: unknown): string | undefined {
	if (!isRecord(result)) {
		return undefined;
	}
	const content = (result as UnknownRecord).content;
	if (!Array.isArray(content)) {
		return undefined;
	}
	const textPart = content.find(
		(c: unknown) =>
			isRecord(c) && c.type === "text" && typeof c.text === "string",
	) as UnknownRecord | undefined;
	return textPart?.text as string | undefined;
}

export function resolveToolType(
	toolName: string,
	toolTypeOption:
		| ToolCalledProperties["type"]
		| ((toolName: string) => ToolCalledProperties["type"] | undefined)
		| undefined,
): ToolCalledProperties["type"] {
	if (typeof toolTypeOption === "function") {
		return toolTypeOption(toolName) ?? "other";
	}
	return toolTypeOption ?? "other";
}

export function buildTrackInput(
	toolName: string,
	extra: unknown,
	options: {
		toolType?: typeof resolveToolType extends (n: string, o: infer T) => unknown
			? T
			: never;
		metadata?: UnknownRecord;
	},
	timing?: { durationMs: number; status: string; errorMessage?: string },
	clientInfo?: { name: string; version: string },
	io?: { input?: unknown; output?: unknown },
): TrackInput {
	const toolType = resolveToolType(toolName, options.toolType);
	const meta = extractMeta(extra);

	return {
		event: "tool.called",
		properties: {
			name: toolName,
			type: toolType,
			...(timing ?? {}),
			...(io?.input !== undefined && { input: io.input }),
			...(io?.output !== undefined && { output: io.output }),
		},
		meta,
		source: extractSource(meta),
		metadata: {
			...(options.metadata ?? {}),
			...(clientInfo && { clientInfo }),
		},
	};
}

export async function safeTrack(
	tracker: Pick<WaniWaniClient, "track">,
	input: TrackInput,
	onError?: (error: Error) => void,
): Promise<void> {
	try {
		await tracker.track(input);
	} catch (error) {
		onError?.(toError(error));
	}
}

export async function safeFlush(
	tracker: Pick<WaniWaniClient, "flush">,
	onError?: (error: Error) => void,
): Promise<void> {
	try {
		await tracker.flush();
	} catch (error) {
		onError?.(toError(error));
	}
}

export async function injectWidgetConfig(
	result: unknown,
	cache: WidgetTokenCache | null,
	apiUrl: string,
	extra?: unknown,
	onError?: (error: Error) => void,
): Promise<void> {
	if (!isRecord(result)) {
		return;
	}

	if (!isRecord(result._meta)) {
		(result as UnknownRecord)._meta = {};
	}

	const meta = (result as UnknownRecord)._meta as UnknownRecord;
	const existingWaniwaniConfig = isRecord(meta.waniwani)
		? (meta.waniwani as UnknownRecord)
		: undefined;
	const waniwaniConfig: UnknownRecord = {
		...(existingWaniwaniConfig ?? {}),
		endpoint:
			existingWaniwaniConfig?.endpoint ??
			`${apiUrl.replace(/\/$/, "")}/api/mcp/events/v2/batch`,
	};

	if (cache) {
		try {
			const token = await cache.getToken();
			if (token) {
				waniwaniConfig.token = token;
			}
		} catch (error) {
			onError?.(toError(error));
		}
	}

	const sessionId = extractSessionId(meta);
	if (sessionId) {
		if (!waniwaniConfig.sessionId) {
			waniwaniConfig.sessionId = sessionId;
		}
	}

	const geoLocation = extractGeoLocation(meta);
	if (geoLocation !== undefined) {
		if (!waniwaniConfig.geoLocation) {
			waniwaniConfig.geoLocation = geoLocation;
		}
	}

	const source = extractSource(extractMeta(extra));
	if (source && !waniwaniConfig.source) {
		waniwaniConfig.source = source;
	}

	meta.waniwani = waniwaniConfig;
}

export function injectRequestMetadata(result: unknown, extra: unknown): void {
	const requestMeta = extractMeta(extra);
	if (!requestMeta) {
		return;
	}

	if (!isRecord(result)) {
		return;
	}

	if (!isRecord(result._meta)) {
		(result as UnknownRecord)._meta = {};
	}

	const resultMeta = (result as UnknownRecord)._meta as UnknownRecord;
	const sessionId = extractSessionId(requestMeta);
	if (sessionId && !resultMeta[SESSION_ID_KEY]) {
		resultMeta[SESSION_ID_KEY] = sessionId;
	}

	const geoLocation = extractGeoLocation(requestMeta);
	if (!geoLocation) {
		return;
	}

	if (!resultMeta[GEO_LOCATION_KEY]) {
		resultMeta[GEO_LOCATION_KEY] = geoLocation;
	}

	if (!resultMeta[LEGACY_USER_LOCATION_KEY]) {
		resultMeta[LEGACY_USER_LOCATION_KEY] = geoLocation;
	}
}

function extractGeoLocation(
	meta: UnknownRecord | undefined,
): UnknownRecord | string | undefined {
	if (!meta) {
		return undefined;
	}

	const geoLocation = meta[GEO_LOCATION_KEY] ?? meta[LEGACY_USER_LOCATION_KEY];
	if (isRecord(geoLocation) || typeof geoLocation === "string") {
		return geoLocation;
	}

	return undefined;
}

/**
 * Inject widget-related keys from the tool definition `_meta` into the result.
 *
 * This ensures widget metadata (resource URIs, etc.) registered at tool
 * definition time is available in the tool result, even when the handler
 * doesn't explicitly include it — e.g. Skybridge widgets.
 *
 * Keys already present in the result take precedence (no overwriting).
 */
export function injectToolDefinitionMeta(
	result: unknown,
	configMeta: UnknownRecord | undefined,
): void {
	if (!configMeta || !isRecord(result)) {
		return;
	}

	if (!isRecord(result._meta)) {
		(result as UnknownRecord)._meta = {};
	}

	const resultMeta = (result as UnknownRecord)._meta as UnknownRecord;
	for (const [key, value] of Object.entries(configMeta)) {
		if (!(key in resultMeta)) {
			resultMeta[key] = value;
		}
	}
}

function toError(error: unknown): Error {
	if (error instanceof Error) {
		return error;
	}
	return new Error(String(error));
}

// ---------------------------------------------------------------------------
// HTTP resource endpoint + httpUrl injection
// ---------------------------------------------------------------------------

export const WANIWANI_RESOURCE_PATH = "/__waniwani/resource";

type ReadResourceCallback = (
	uri: URL,
	extra?: Record<string, unknown>,
) => Promise<{
	contents: Array<{
		uri: string;
		mimeType?: string;
		text?: string;
		blob?: string;
	}>;
}>;

export type ResourceCallbackMap = Map<string, ReadResourceCallback>;

function headerValue(headers: UnknownRecord, key: string): string | undefined {
	const val = headers[key];
	if (typeof val === "string") {
		return val;
	}
	if (Array.isArray(val) && typeof val[0] === "string") {
		return val[0];
	}
	return undefined;
}

/**
 * Derive the MCP server's public origin from `extra.requestInfo`.
 *
 * Tries (in order):
 * 1. `requestInfo.url.origin` (set by StreamableHTTP transports)
 * 2. `x-forwarded-proto` + `x-forwarded-host` headers (reverse proxies / ngrok)
 * 3. `host` header with protocol inference
 *
 * Returns `undefined` when the origin cannot be determined (e.g. stdio transport).
 */
export function deriveServerOrigin(extra: unknown): string | undefined {
	if (!isRecord(extra)) {
		return undefined;
	}

	const requestInfo = extra.requestInfo;
	if (!isRecord(requestInfo)) {
		return undefined;
	}

	// 1. requestInfo.url.origin (most reliable — set by StreamableHTTP transports)
	const url = requestInfo.url;
	if (
		isRecord(url) &&
		typeof url.origin === "string" &&
		url.origin !== "null"
	) {
		return url.origin;
	}

	// 2. Headers-based fallback
	const headers = requestInfo.headers;
	if (!isRecord(headers)) {
		return undefined;
	}

	const forwardedHost = headerValue(headers, "x-forwarded-host");
	if (forwardedHost) {
		const proto = headerValue(headers, "x-forwarded-proto") ?? "https";
		return `${proto}://${forwardedHost}`;
	}

	const host = headerValue(headers, "host");
	if (host) {
		const isLocal =
			host.startsWith("127.0.0.1:") || host.startsWith("localhost:");
		return `${isLocal ? "http" : "https"}://${host}`;
	}

	return undefined;
}

/**
 * Inject `_meta.ui.httpUrl` into the tool result when:
 * - `_meta.ui.resourceUri` is present (widget tool)
 * - `_meta.ui.httpUrl` is NOT already set (don't overwrite SDK's own value)
 * - We have a captured read callback for that URI (so the endpoint can serve it)
 * - The server origin is derivable from the request
 */
export function injectHttpUrl(
	result: unknown,
	extra: unknown,
	resourceCallbacks: ResourceCallbackMap,
): void {
	if (!isRecord(result) || !isRecord(result._meta)) {
		return;
	}

	const meta = result._meta as UnknownRecord;
	const ui = meta.ui;
	if (!isRecord(ui)) {
		return;
	}

	const resourceUri = ui.resourceUri;
	if (typeof resourceUri !== "string" || typeof ui.httpUrl === "string") {
		return;
	}

	if (!resourceCallbacks.has(resourceUri)) {
		return;
	}

	const origin = deriveServerOrigin(extra);
	if (!origin) {
		return;
	}

	ui.httpUrl = `${origin}${WANIWANI_RESOURCE_PATH}?uri=${encodeURIComponent(resourceUri)}`;
}

/**
 * Express-compatible middleware that serves MCP resources via HTTP GET.
 *
 * Duck-typed req/res to avoid express as a runtime dependency.
 */
export function createWaniwaniResourceHandler(
	callbacks: ResourceCallbackMap,
): (req: unknown, res: unknown, next: unknown) => void {
	return (req: unknown, res: unknown, next: unknown) => {
		const request = req as {
			method?: string;
			query?: UnknownRecord;
			url?: string;
			headers?: UnknownRecord;
		};
		const response = res as {
			status: (code: number) => {
				send: (body: string) => void;
				json: (body: unknown) => void;
				end: () => void;
			};
			setHeader: (name: string, value: string) => void;
		};
		const nextFn =
			typeof next === "function" ? (next as () => void) : undefined;

		if (request.method !== "GET") {
			nextFn?.();
			return;
		}

		// Extract uri from express query or raw URL
		let uri: string | null = null;
		if (request.query && typeof request.query.uri === "string") {
			uri = request.query.uri;
		} else if (request.url) {
			try {
				uri = new URL(request.url, "http://localhost").searchParams.get("uri");
			} catch {
				// invalid URL
			}
		}

		if (!uri) {
			response.status(400).json({ error: "Missing uri query parameter" });
			return;
		}

		const callback = callbacks.get(uri);
		if (!callback) {
			response.status(404).json({ error: "Resource not found" });
			return;
		}

		const requestHeaders = isRecord(request.headers) ? request.headers : {};

		Promise.resolve(
			callback(new URL(uri), { requestInfo: { headers: requestHeaders } }),
		)
			.then((result) => {
				const content = result?.contents?.[0];
				if (!content) {
					response.status(404).json({ error: "Resource has no content" });
					return;
				}

				let html: string | undefined;
				if (typeof content.text === "string") {
					html = content.text;
				} else if (typeof content.blob === "string") {
					html = atob(content.blob);
				}

				if (!html) {
					response.status(404).json({ error: "Resource has no content" });
					return;
				}

				response.setHeader("Content-Type", "text/html");
				response.setHeader("Cache-Control", "private, max-age=300");
				response.status(200).send(html);
			})
			.catch((err: unknown) => {
				const message = err instanceof Error ? err.message : "Unknown error";
				response.status(500).json({ error: message });
			});
	};
}
