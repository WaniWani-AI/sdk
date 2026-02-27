import type { ToolCalledProperties, TrackInput } from "../../tracking/index.js";
import type { WaniWaniClient, WaniWaniConfig } from "../../types.js";
import { waniwani } from "../../waniwani.js";
import type { McpServer } from "./tools/types";
import { WidgetTokenCache } from "./widget-token.js";

type WaniwaniTracker = Pick<WaniWaniClient, "flush" | "track" | "_config">;
type UnknownRecord = Record<string, unknown>;

type WrappedServer = McpServer & {
	__waniwaniWrapped?: true;
};

/**
 * Options for withWaniwani().
 */
export type WithWaniwaniOptions = {
	/**
	 * Optional pre-built WaniWani client.
	 * When omitted, a new client is created from `config`.
	 */
	client?: WaniwaniTracker;
	/**
	 * WaniWani client config used when `client` is omitted.
	 */
	config?: WaniWaniConfig;
	/**
	 * Optional explicit tool type. Defaults to `"other"`.
	 */
	toolType?:
		| ToolCalledProperties["type"]
		| ((toolName: string) => ToolCalledProperties["type"] | undefined);
	/**
	 * Optional metadata merged into every tracked event.
	 */
	metadata?: UnknownRecord;
	/**
	 * Flush tracking transport after each tool call.
	 */
	flushAfterToolCall?: boolean;
	/**
	 * Optional error callback for non-fatal tracking errors.
	 */
	onError?: (error: Error) => void;
	/**
	 * Inject widget tracking config into tool response `_meta.waniwani` so browser
	 * widgets can send events directly to the WaniWani backend.
	 *
	 * Always injects `endpoint`. Injects `token` when an API key is configured
	 * and token minting succeeds.
	 *
	 * @default true
	 */
	injectWidgetToken?: boolean;
};

const DEFAULT_BASE_URL = "https://app.waniwani.ai";

/**
 * Wrap an MCP server so tool handlers automatically emit `tool.called` events.
 *
 * The wrapper intercepts `server.registerTool(...)`, tracks each invocation,
 * then forwards execution to the original tool handler.
 *
 * When `injectWidgetToken` is enabled (default), tracking config is injected
 * into tool response `_meta.waniwani` so browser widgets can post events
 * directly to the WaniWani backend without a server-side proxy.
 */
export function withWaniwani(
	server: McpServer,
	options: WithWaniwaniOptions = {},
): McpServer {
	const wrappedServer = server as WrappedServer;
	if (wrappedServer.__waniwaniWrapped) {
		return wrappedServer;
	}

	wrappedServer.__waniwaniWrapped = true;

	const tracker = options.client ?? waniwani(options.config);
	const injectToken = options.injectWidgetToken !== false;

	// Lazy-init token cache — only created if we have an API key
	let tokenCache: WidgetTokenCache | null = null;

	function getTokenCache(): WidgetTokenCache | null {
		if (tokenCache) return tokenCache;
		const apiKey = tracker._config.apiKey;
		if (!apiKey) return null;
		tokenCache = new WidgetTokenCache({
			baseUrl: tracker._config.baseUrl ?? DEFAULT_BASE_URL,
			apiKey,
		});
		return tokenCache;
	}

	const originalRegisterTool = server.registerTool.bind(server) as (
		...args: unknown[]
	) => unknown;

	wrappedServer.registerTool = ((...args: unknown[]) => {
		const [toolNameRaw, config, handlerRaw] = args;
		const toolName =
			typeof toolNameRaw === "string" && toolNameRaw.trim().length > 0
				? toolNameRaw
				: "unknown";

		if (typeof handlerRaw !== "function") {
			return originalRegisterTool(...args);
		}

		const handler = handlerRaw as (
			input: unknown,
			extra: unknown,
		) => Promise<unknown> | unknown;

		const wrappedHandler = async (input: unknown, extra: unknown) => {
			const startTime = performance.now();
			try {
				const result = await handler(input, extra);
				const durationMs = Math.round(performance.now() - startTime);

				await safeTrack(
					tracker,
					buildTrackInput(toolName, extra, options, {
						durationMs,
						status: "ok",
					}),
					options.onError,
				);

				if (options.flushAfterToolCall) {
					await safeFlush(tracker, options.onError);
				}

				if (injectToken) {
					await injectWidgetConfig(
						result,
						getTokenCache(),
						tracker._config.baseUrl ?? DEFAULT_BASE_URL,
						options.onError,
					);
				}

				return result;
			} catch (error) {
				const durationMs = Math.round(performance.now() - startTime);

				await safeTrack(
					tracker,
					buildTrackInput(toolName, extra, options, {
						durationMs,
						status: "error",
						errorMessage:
							error instanceof Error ? error.message : String(error),
					}),
					options.onError,
				);

				if (options.flushAfterToolCall) {
					await safeFlush(tracker, options.onError);
				}

				throw error;
			}
		};

		return originalRegisterTool(toolNameRaw, config, wrappedHandler);
	}) as McpServer["registerTool"];

	return wrappedServer;
}

async function injectWidgetConfig(
	result: unknown,
	cache: WidgetTokenCache | null,
	baseUrl: string,
	onError?: (error: Error) => void,
): Promise<void> {
	if (!isRecord(result)) return;

	if (!isRecord(result._meta)) {
		(result as UnknownRecord)._meta = {};
	}

	const meta = (result as UnknownRecord)._meta as UnknownRecord;
	const waniwaniConfig: UnknownRecord = {
		endpoint: `${baseUrl.replace(/\/$/, "")}/api/mcp/events/v2/batch`,
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

	meta.waniwani = waniwaniConfig;
}

function buildTrackInput(
	toolName: string,
	extra: unknown,
	options: WithWaniwaniOptions,
	timing?: { durationMs: number; status: string; errorMessage?: string },
): TrackInput {
	const toolType = resolveToolType(toolName, options.toolType);
	const meta = extractMeta(extra);

	return {
		event: "tool.called",
		properties: {
			name: toolName,
			type: toolType,
			...(timing ?? {}),
		},
		meta,
		metadata: {
			source: "withWaniwani",
			...(options.metadata ?? {}),
		},
	};
}

function resolveToolType(
	toolName: string,
	toolTypeOption: WithWaniwaniOptions["toolType"],
): ToolCalledProperties["type"] {
	if (typeof toolTypeOption === "function") {
		return toolTypeOption(toolName) ?? "other";
	}
	return toolTypeOption ?? "other";
}

function extractMeta(extra: unknown): UnknownRecord | undefined {
	if (!isRecord(extra)) return undefined;

	const meta = extra._meta;
	if (!isRecord(meta)) return undefined;

	return meta;
}

function isRecord(value: unknown): value is UnknownRecord {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function safeTrack(
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

async function safeFlush(
	tracker: Pick<WaniWaniClient, "flush">,
	onError?: (error: Error) => void,
): Promise<void> {
	try {
		await tracker.flush();
	} catch (error) {
		onError?.(toError(error));
	}
}

function toError(error: unknown): Error {
	if (error instanceof Error) {
		return error;
	}
	return new Error(String(error));
}
