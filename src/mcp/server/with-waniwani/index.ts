import type { ToolCalledProperties } from "../../../tracking/index.js";
import { createLogger } from "../../../utils/logger.js";
import { waniwani } from "../../../waniwani.js";
import type { FlowGraph } from "../flows/@types.js";
import { createScopedClient, SCOPED_CLIENT_KEY } from "../scoped-client.js";
import type { McpServer } from "../tools/types";
import { extractSessionId } from "../utils.js";
import { WidgetTokenCache } from "../widget-token.js";
import { syncFlowGraphs } from "./funnel-sync.js";
import {
	buildTrackInput,
	extractErrorText,
	extractMeta,
	injectRequestMetadata,
	injectWidgetConfig,
	injectWidgetDefinitionMeta,
	isRecord,
	safeFlush,
	safeTrack,
	type WaniwaniTracker,
} from "./helpers.js";
import { extractTransportSessionId } from "./transport-session.js";

type UnknownRecord = Record<string, unknown>;
type RawHandler = (
	input: unknown,
	extra: unknown,
) => Promise<unknown> | unknown;

type WrappedServer = McpServer & {
	__waniwaniWrapped?: true;
};

const WRAPPED_HANDLER = Symbol.for("waniwani.wrappedHandler");

type MaybeWrappedHandler = RawHandler & { [WRAPPED_HANDLER]?: true };

/**
 * Options for withWaniwani().
 */
export type WithWaniwaniOptions = {
	/**
	 * The WaniWani client instance. When omitted, a client is created
	 * automatically using the global config registered by `defineConfig()`,
	 * falling back to env vars.
	 */
	client?: WaniwaniTracker;
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

const log = createLogger("mcp", !!process.env.WANIWANI_DEBUG);

const DEFAULT_BASE_URL = "https://app.waniwani.ai";

type WrapContext = {
	server: McpServer;
	tracker: WaniwaniTracker;
	opts: WithWaniwaniOptions;
	tokenCache: WidgetTokenCache | null;
	injectToken: boolean;
};

type UnknownRecordOrUndefined = UnknownRecord | undefined;

function createWrappedHandler(
	toolName: string,
	originalHandler: RawHandler,
	ctx: WrapContext,
	definitionMeta: UnknownRecordOrUndefined,
): MaybeWrappedHandler {
	const { server, tracker, opts, tokenCache, injectToken } = ctx;

	const wrappedHandler: MaybeWrappedHandler = async (
		input: unknown,
		extra: unknown,
	) => {
		// Inject scoped client into extra so createTool/flows can surface it
		const meta = extractMeta(extra) ?? {};

		// Bridge transport-level session ID into _meta when the host doesn't
		// include one directly (e.g. Mcp-Session-Id HTTP header).
		const existingSessionId = extractSessionId(meta);
		console.log(
			"[waniwani:debug] bridge sessionId — existingSessionId from meta:",
			existingSessionId,
			"| meta keys:",
			Object.keys(meta),
		);
		if (!existingSessionId && isRecord(extra)) {
			const transportSid = extractTransportSessionId(extra as UnknownRecord);
			console.log(
				"[waniwani:debug] bridge sessionId — transportSid:",
				transportSid,
			);
			if (transportSid) {
				meta["waniwani/sessionId"] = transportSid;
				(extra as UnknownRecord)._meta = meta;
			}
		}

		const scopedClient = createScopedClient(tracker, meta, {
			apiUrl: tracker._config.apiUrl,
			apiKey: tracker._config.apiKey,
		});
		if (isRecord(extra)) {
			extra[SCOPED_CLIENT_KEY] = scopedClient;
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
			const result = await originalHandler(input, extra);
			const durationMs = Math.round(performance.now() - startTime);

			log(
				`tool "${toolName}" handler returned in ${durationMs}ms, running post-processing...`,
			);

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
					opts,
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
				opts.onError,
			);

			log(`tool "${toolName}" tracking done`);

			if (opts.flushAfterToolCall) {
				await safeFlush(tracker, opts.onError);
			}

			injectRequestMetadata(result, extra);
			injectWidgetDefinitionMeta(result, definitionMeta);

			if (injectToken) {
				await injectWidgetConfig(
					result,
					tokenCache,
					tracker._config.apiUrl ?? DEFAULT_BASE_URL,
					extra,
					opts.onError,
				);
				log(`tool "${toolName}" widget config injected`);
			}

			log(`tool "${toolName}" post-processing complete, returning result`);

			return result;
		} catch (error) {
			const durationMs = Math.round(performance.now() - startTime);

			await safeTrack(
				tracker,
				buildTrackInput(
					toolName,
					extra,
					opts,
					{
						durationMs,
						status: "error",
						errorMessage:
							error instanceof Error ? error.message : String(error),
					},
					clientInfo,
					{ input },
				),
				opts.onError,
			);

			if (opts.flushAfterToolCall) {
				await safeFlush(tracker, opts.onError);
			}

			throw error;
		}
	};

	wrappedHandler[WRAPPED_HANDLER] = true;
	return wrappedHandler;
}

/**
 * Wrap an MCP server so tool handlers automatically emit `tool.called` events.
 *
 * The wrapper intercepts `server.registerTool(...)` for future registrations
 * and also walks `server._registeredTools` to wrap any tools already registered
 * at the time of the call. This means either call order works:
 *
 *   withWaniwani(server); server.registerTool(...);   // wrap then register
 *   server.registerTool(...); withWaniwani(server);   // register then wrap
 *
 * When `injectWidgetToken` is enabled (default), tracking config is injected
 * into tool response `_meta.waniwani` so browser widgets can post events
 * directly to the WaniWani backend without a server-side proxy.
 *
 * Widget metadata declared on the tool **definition** (e.g. skybridge's
 * `registerWidget`, raw MCP `_meta["ui/resourceUri"]` / `_meta.ui.resourceUri`,
 * OpenAI's `_meta["openai/outputTemplate"]`) is also forwarded into each tool
 * result's `_meta`, so chat UIs that only see tool results (and not
 * `tools/list`) can still render widgets. Handler-set keys take precedence.
 */
export function withWaniwani(
	server: McpServer,
	options?: WithWaniwaniOptions,
): McpServer {
	const wrappedServer = server as WrappedServer;
	if (wrappedServer.__waniwaniWrapped) {
		return wrappedServer;
	}

	wrappedServer.__waniwaniWrapped = true;

	const opts = options ?? {};
	const tracker = opts.client ?? waniwani();
	const injectToken = opts.injectWidgetToken !== false;

	const tokenCache: WidgetTokenCache | null = tracker._config.apiKey
		? new WidgetTokenCache({
				apiUrl: tracker._config.apiUrl ?? DEFAULT_BASE_URL,
				apiKey: tracker._config.apiKey,
			})
		: null;

	const ctx: WrapContext = {
		server,
		tracker,
		opts,
		tokenCache,
		injectToken,
	};

	const originalRegisterTool = server.registerTool.bind(server) as (
		...args: unknown[]
	) => unknown;

	wrappedServer.registerTool = ((...args: unknown[]) => {
		const [toolNameRaw, config, handlerRaw] = args;

		if (typeof handlerRaw !== "function") {
			return originalRegisterTool(...args);
		}

		const toolName =
			typeof toolNameRaw === "string" && toolNameRaw.trim().length > 0
				? toolNameRaw
				: "unknown";

		const definitionMeta =
			isRecord(config) && isRecord((config as UnknownRecord)._meta)
				? ((config as UnknownRecord)._meta as UnknownRecord)
				: undefined;

		const wrapped = createWrappedHandler(
			toolName,
			handlerRaw as RawHandler,
			ctx,
			definitionMeta,
		);
		return originalRegisterTool(toolNameRaw, config, wrapped);
	}) as McpServer["registerTool"];

	// Wrap any tools that were already registered before withWaniwani() ran.
	// MCP SDK internal: `_registeredTools` is the dictionary used by the
	// `tools/call` request handler; each entry has a mutable `handler` field
	// that is looked up by name and invoked by reference at call time
	// (see @modelcontextprotocol/sdk/dist/esm/server/mcp.js:_createRegisteredTool),
	// so reassigning `entry.handler` safely upgrades existing tools in place.
	// Skybridge's McpServer subclass uses the same storage via `super.registerTool`.
	const registeredTools = (
		server as unknown as {
			_registeredTools?: Record<string, { handler?: unknown; _meta?: unknown }>;
		}
	)._registeredTools;

	if (isRecord(registeredTools)) {
		for (const [toolName, entry] of Object.entries(registeredTools)) {
			if (!isRecord(entry)) {
				continue;
			}
			const existing = entry.handler as MaybeWrappedHandler | undefined;
			if (typeof existing !== "function") {
				continue;
			}
			if (existing[WRAPPED_HANDLER]) {
				continue;
			}

			const definitionMeta = isRecord(entry._meta)
				? (entry._meta as UnknownRecord)
				: undefined;

			entry.handler = createWrappedHandler(
				toolName,
				existing,
				ctx,
				definitionMeta,
			);
		}
	}

	if (tracker._config.apiKey) {
		const registeredToolsMap = (
			server as unknown as {
				_registeredTools?: Record<string, { _meta?: unknown }>;
			}
		)._registeredTools;

		const flowGraphs: FlowGraph[] = [];
		if (registeredToolsMap && typeof registeredToolsMap === "object") {
			for (const entry of Object.values(registeredToolsMap)) {
				if (entry && typeof entry === "object") {
					const meta = (entry as Record<string, unknown>)._meta;
					const fg =
						meta && typeof meta === "object"
							? ((meta as Record<string, unknown>)._flowGraph as
									| FlowGraph
									| undefined)
							: undefined;
					if (fg?.nodes?.length) {
						flowGraphs.push(fg);
					}
				}
			}
		}

		if (flowGraphs.length > 0) {
			syncFlowGraphs(
				flowGraphs,
				tracker._config.apiUrl ?? DEFAULT_BASE_URL,
				tracker._config.apiKey,
			);
		}
	}

	return wrappedServer;
}
