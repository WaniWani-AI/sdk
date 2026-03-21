import type { ToolCalledProperties } from "../../../tracking/index.js";
import { createScopedClient, SCOPED_CLIENT_KEY } from "../scoped-client.js";
import type { McpServer } from "../tools/types";
import { WidgetTokenCache } from "../widget-token.js";
import {
	buildTrackInput,
	extractErrorText,
	extractMeta,
	injectRequestMetadata,
	injectWidgetConfig,
	isRecord,
	safeFlush,
	safeTrack,
	type WaniwaniTracker,
} from "./helpers.js";

type UnknownRecord = Record<string, unknown>;

type WrappedServer = McpServer & {
	__waniwaniWrapped?: true;
};

/**
 * Options for withWaniwani().
 */
export type WithWaniwaniOptions = {
	/**
	 * The WaniWani client instance. All tracking calls made through this client
	 * during tool execution will automatically include session metadata.
	 */
	client: WaniwaniTracker;
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
	options: WithWaniwaniOptions,
): McpServer {
	const wrappedServer = server as WrappedServer;
	if (wrappedServer.__waniwaniWrapped) {
		return wrappedServer;
	}

	wrappedServer.__waniwaniWrapped = true;

	const tracker = options.client;
	const injectToken = options.injectWidgetToken !== false;

	let tokenCache: WidgetTokenCache | null = null;

	function getTokenCache(): WidgetTokenCache | null {
		if (tokenCache) {
			return tokenCache;
		}
		const apiKey = tracker._config.apiKey;
		if (!apiKey) {
			return null;
		}
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
			// Inject scoped client into extra so createTool/flows can surface it
			const meta = extractMeta(extra) ?? {};
			const scopedClient = createScopedClient(tracker, meta);
			if (isRecord(extra)) {
				(extra as UnknownRecord)[SCOPED_CLIENT_KEY] = scopedClient;
			}

			const startTime = performance.now();
			const clientInfo = (
				server as {
					server?: {
						getClientVersion?: () =>
							| { name: string; version: string }
							| undefined;
					};
				}
			).server?.getClientVersion?.();
			try {
				const result = await handler(input, extra);
				const durationMs = Math.round(performance.now() - startTime);

				const isErrorResult =
					isRecord(result) && (result as UnknownRecord).isError === true;

				if (isErrorResult) {
					const errorText = extractErrorText(result);
					console.error(
						`[waniwani] Tool "${toolName}" returned error${errorText ? `: ${errorText}` : ""}`,
					);
				}

				await safeTrack(
					tracker,
					buildTrackInput(
						toolName,
						extra,
						options,
						{
							durationMs,
							status: isErrorResult ? "error" : "ok",
							...(isErrorResult && {
								errorMessage: extractErrorText(result) ?? "Unknown tool error",
							}),
						},
						clientInfo,
						{ input, output: result },
					),
					options.onError,
				);

				if (options.flushAfterToolCall) {
					await safeFlush(tracker, options.onError);
				}

				injectRequestMetadata(result, extra);

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
					buildTrackInput(
						toolName,
						extra,
						options,
						{
							durationMs,
							status: "error",
							errorMessage:
								error instanceof Error ? error.message : String(error),
						},
						clientInfo,
						{ input },
					),
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
