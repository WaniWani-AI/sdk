import {
	type RetrievalCollector,
	retrievalCollectorStore,
} from "../../../kb/retrieval-context.js";
import type { ToolCalledProperties } from "../../../tracking/index.js";
import { createLogger } from "../../../utils/logger.js";
import { waniwani } from "../../../waniwani.js";
import type { FlowGraph } from "../flows/@types.js";
import { REDACTED_STATE_UPDATE_FIELDS_META_KEY } from "../flows/redacted.js";
import { createScopedClient, SCOPED_CLIENT_KEY } from "../scoped-client.js";
import {
	extractSessionId,
	extractSource,
	extractSourceFromHeaders,
} from "../utils.js";
import { WidgetTokenCache } from "../widget-token.js";
import type { FunnelSyncPayload } from "./funnel-sync.js";
import { prepareFunnelSyncPayload } from "./funnel-sync.js";
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
import type { CaptureIntentOptions, IntentCapture } from "./intent-capture.js";
import { createIntentCapture, stripIntentArgument } from "./intent-capture.js";
import { extractTransportSessionId } from "./transport-session.js";

type UnknownRecord = Record<string, unknown>;
type RawHandler = (
	input: unknown,
	extra: unknown,
) => Promise<unknown> | unknown;

/**
 * The structural surface `withWaniwani` needs from an MCP server.
 *
 * Deliberately *not* the MCP SDK's `McpServer` class type. That class declares
 * 23 private members, and TypeScript compares private members nominally — so
 * only an instance of that exact class satisfies it. Any subclass that
 * re-exports a narrowed public surface through a mapped type fails the check:
 * skybridge declares `class McpServer extends Omit<McpServerBase, "registerTool"
 * | "connect">`, and `Omit` drops every private member, leaving a type that is
 * structurally an MCP server but nominally unassignable. Callers were forced
 * into `withWaniwani(server as unknown as Parameters<typeof withWaniwani>[0])`.
 *
 * Nothing is lost by widening: every member this function actually touches
 * (`registerTool`, the private `_registeredTools`, `.server.getClientVersion()`)
 * is already reached through an internal cast, so the nominal parameter type
 * never provided safety inside the function — only friction outside it.
 */
export type InstrumentableMcpServer = {
	// `any` parameters keep this compatible with both the SDK's
	// `(name, config, handler)` overloads and skybridge's `(config, handler)`
	// form; the body calls it through an untyped varargs cast either way.
	// biome-ignore lint/suspicious/noExplicitAny: see above
	registerTool: (...args: any[]) => unknown;
};

type WrappedServer = InstrumentableMcpServer & {
	__waniwaniWrapped?: true;
};

const WRAPPED_HANDLER = Symbol.for("waniwani.wrappedHandler");

type MaybeWrappedHandler = RawHandler & { [WRAPPED_HANDLER]?: true };

/**
 * Options for withWaniwani().
 */
export type WithWaniwaniOptions = {
	/**
	 * The Waniwani client instance. When omitted, a client is created
	 * automatically from `waniwani.json` / the global config registered by
	 * `defineConfig()`, falling back to env vars (`WANIWANI_API_KEY` and
	 * `WANIWANI_API_URL`). Set `WANIWANI_API_URL` (e.g.
	 * `https://eu.app.waniwani.ai`) so the auto-created client targets the
	 * right region instead of defaulting to US.
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
	 * widgets can send events directly to the Waniwani backend.
	 *
	 * Always injects `endpoint`. Injects `token` when an API key is configured
	 * and token minting succeeds.
	 *
	 * @default true
	 */
	injectWidgetToken?: boolean;
	/**
	 * List of field names to strip from known location `_meta` entries
	 * (`openai/userLocation`, `waniwani/geoLocation`, `waniwani/userLocation`)
	 * before events are sent to the Waniwani API. Applied to both the
	 * request-level `_meta` and any `_meta` on the tool response.
	 *
	 * Pass e.g. `["latitude", "longitude"]` to drop coordinates only, or
	 * `["latitude", "longitude", "city", "region"]` to keep just `country`.
	 * Empty/omitted = no redaction.
	 *
	 * @default []
	 */
	stripLocationFields?: readonly string[];
	/**
	 * Replace `input.stateUpdates[field]` with `"REDACTED"` for any field
	 * marked via `redacted()` on a flow state schema. When `false` (default),
	 * the declarative markers are ignored and raw values are tracked.
	 *
	 * Wire this to an env var when you want real values in development logs
	 * but redacted values in production.
	 *
	 * @default false
	 */
	applyFieldRedactions?: boolean;
	/**
	 * Capture the user's goal behind each tool call.
	 *
	 * Adds an optional `intent` argument to every tool's input schema, which the
	 * calling model fills in with what the user is trying to achieve. The value
	 * is stripped before the tool's own handler runs and tracked as
	 * `properties.input.intent` on `tool.called` — the same field flow tools
	 * already record, so both read back identically.
	 *
	 * Tools that already declare the argument are left untouched (flow tools,
	 * and any tool whose own schema carries the goal). Pass an object to narrow
	 * capture to specific tools (`tools`), rename the argument
	 * (`argumentName`), or ask the model to keep PII out of it (`omitPII`).
	 * Pass `false` to switch it off entirely — the escape hatch for a server
	 * whose tool contract must not change.
	 *
	 * @default true
	 */
	captureIntent?: boolean | CaptureIntentOptions;
};

const log = createLogger("mcp");

const DEFAULT_BASE_URL = "https://app.waniwani.ai";

const REDACTED_VALUE = "REDACTED";

function buildStateUpdateRedactor(
	definitionMeta: UnknownRecord | undefined,
): ((input: unknown) => unknown) | undefined {
	if (!definitionMeta) {
		return undefined;
	}
	const fields = definitionMeta[REDACTED_STATE_UPDATE_FIELDS_META_KEY];
	if (!Array.isArray(fields) || fields.length === 0) {
		return undefined;
	}
	const fieldSet = new Set(
		fields.filter((f): f is string => typeof f === "string"),
	);
	if (fieldSet.size === 0) {
		return undefined;
	}

	return (input: unknown) => {
		if (!isRecord(input)) {
			return input;
		}
		const stateUpdates = input.stateUpdates;
		if (!isRecord(stateUpdates)) {
			return input;
		}
		let changed = false;
		const next: UnknownRecord = { ...stateUpdates };
		for (const field of fieldSet) {
			if (field in next) {
				next[field] = REDACTED_VALUE;
				changed = true;
			}
		}
		if (!changed) {
			return input;
		}
		return { ...input, stateUpdates: next };
	};
}

type WrapContext = {
	server: InstrumentableMcpServer;
	tracker: WaniwaniTracker;
	opts: WithWaniwaniOptions;
	tokenCache: WidgetTokenCache | null;
	injectToken: boolean;
	funnelSync: FunnelSyncPayload | null;
	/** `null` when `captureIntent: false` turns capture off. */
	intentCapture: IntentCapture | null;
};

type InjectedIntent = {
	argumentName: string;
	/**
	 * The tool declared no input schema of its own. The MCP SDK calls a schemaless
	 * tool as `handler(extra)` and a schema-carrying one as `handler(args, extra)`,
	 * so the injected schema shifts the call shape and the tool's own handler
	 * still expects the single-argument form.
	 */
	schemaWasAbsent: boolean;
};

type UnknownRecordOrUndefined = UnknownRecord | undefined;

/**
 * Add the intent argument to one tool's input schema.
 *
 * Returns the extended schema together with what the wrapped handler has to
 * strip again, or `undefined` when the tool is left alone: capture is off, the
 * tool is outside the allow-list, the tool already declares the argument, or
 * its schema is not an object we can extend.
 *
 * Both registration orders funnel through here — the intercepted
 * `registerTool` (which puts the schema on the config) and the
 * `_registeredTools` walk (which assigns `entry.inputSchema`).
 */
function captureIntentFor(
	toolName: string,
	inputSchema: unknown,
	ctx: WrapContext,
): { schema: unknown; injected: InjectedIntent } | undefined {
	const capture = ctx.intentCapture;
	if (!capture?.appliesTo(toolName)) {
		return undefined;
	}

	const schema = capture.augment(inputSchema);
	if (schema === undefined) {
		return undefined;
	}

	return {
		schema,
		injected: {
			argumentName: capture.argumentName,
			schemaWasAbsent: inputSchema === undefined || inputSchema === null,
		},
	};
}

function createWrappedHandler(
	toolName: string,
	originalHandler: RawHandler,
	ctx: WrapContext,
	definitionMeta: UnknownRecordOrUndefined,
	injectedIntent: InjectedIntent | undefined,
): MaybeWrappedHandler {
	const { server, tracker, opts, tokenCache, injectToken } = ctx;

	const stateUpdateRedactor =
		opts.applyFieldRedactions === true
			? buildStateUpdateRedactor(definitionMeta)
			: undefined;

	// The intent argument is ours, not the tool's: track it as part of the input,
	// but hand the handler the parameters it actually declared, in the call shape
	// it was registered with. Which of the three shapes applies is fixed at
	// registration, so resolve it once here rather than on every call.
	const invokeOriginal: RawHandler = !injectedIntent
		? originalHandler
		: injectedIntent.schemaWasAbsent
			? // The tool declared no input schema, so its handler takes `extra`
				// alone. The injected schema makes the MCP SDK call this wrapper as
				// `(args, extra)`; a caller that still uses the single-argument shape
				// passes the extra as `input` and nothing else.
				(input, extra) =>
					(originalHandler as unknown as (extra: unknown) => unknown)(
						extra === undefined ? input : extra,
					)
			: (input, extra) =>
					originalHandler(
						stripIntentArgument(input, injectedIntent.argumentName),
						extra,
					);

	const wrappedHandler: MaybeWrappedHandler = async (
		input: unknown,
		extra: unknown,
	) => {
		const effectiveOpts = stateUpdateRedactor
			? {
					...opts,
					redactInput: stateUpdateRedactor,
					funnelSync: ctx.funnelSync,
				}
			: { ...opts, funnelSync: ctx.funnelSync };
		// Inject scoped client into extra so createTool/flows can surface it
		const meta = extractMeta(extra) ?? {};

		const clientInfo = (
			server as {
				server?: {
					getClientVersion?: () =>
						| { name: string; version: string }
						| undefined;
				};
			}
		).server?.getClientVersion?.();

		// Bridge transport-level session ID into _meta when the host doesn't
		// include one directly (e.g. Mcp-Session-Id HTTP header).
		const existingSessionId = extractSessionId(meta);
		if (!existingSessionId && isRecord(extra)) {
			const transportSid = extractTransportSessionId(extra as UnknownRecord);
			if (transportSid) {
				meta["waniwani/sessionId"] = transportSid;
				(extra as UnknownRecord)._meta = meta;
			}
		}

		// Resolve and stamp the caller source into _meta once, so downstream
		// consumers (flow nodes, nested tool handlers, tracking) can branch on
		// `waniwani/source` without each re-deriving it from clientInfo/headers.
		// Hosts like Claude carry no source in _meta and no transport session id;
		// clientInfo (MCP initialize) and the request headers are the only signals.
		if (!extractSource(meta) && isRecord(extra)) {
			const headers = (extra as { requestInfo?: { headers?: unknown } })
				.requestInfo?.headers as Record<string, unknown> | undefined;
			const resolvedSource =
				extractSource(meta, clientInfo) ?? extractSourceFromHeaders(headers);
			if (resolvedSource) {
				meta["waniwani/source"] = resolvedSource;
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

		const retrievalCollector: RetrievalCollector = { searches: [] };
		const startTime = performance.now();
		try {
			const result = await retrievalCollectorStore.run(
				retrievalCollector,
				invokeOriginal,
				input,
				extra,
			);
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
					effectiveOpts,
					{
						durationMs,
						status: isErrorResult ? "error" : "ok",
						...(isErrorResult && {
							errorMessage: extractErrorText(result) ?? "Unknown tool error",
						}),
					},
					clientInfo,
					{ input, output: result },
					retrievalCollector.searches,
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
					clientInfo,
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
					effectiveOpts,
					{
						durationMs,
						status: "error",
						errorMessage:
							error instanceof Error ? error.message : String(error),
					},
					clientInfo,
					{ input },
					retrievalCollector.searches,
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
 * directly to the Waniwani backend without a server-side proxy.
 *
 * Widget metadata declared on the tool **definition** (e.g. skybridge's
 * `registerWidget`, raw MCP `_meta["ui/resourceUri"]` / `_meta.ui.resourceUri`,
 * OpenAI's `_meta["openai/outputTemplate"]`) is also forwarded into each tool
 * result's `_meta`, so chat UIs that only see tool results (and not
 * `tools/list`) can still render widgets. Handler-set keys take precedence.
 *
 * Every tool's input schema also gains an optional `intent` argument so the
 * calling model records the user's goal; the value is stripped before the tool's
 * handler runs and tracked on `tool.called`. Pass `captureIntent: false` to
 * leave tool schemas exactly as declared.
 */
export async function withWaniwani<TServer extends InstrumentableMcpServer>(
	server: TServer,
	options?: WithWaniwaniOptions,
): Promise<TServer> {
	const wrappedServer = server as WrappedServer;
	if (wrappedServer.__waniwaniWrapped) {
		return server;
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
		funnelSync: null,
		intentCapture: createIntentCapture(opts.captureIntent),
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

		const capture = isRecord(config)
			? captureIntentFor(toolName, (config as UnknownRecord).inputSchema, ctx)
			: undefined;

		const wrapped = createWrappedHandler(
			toolName,
			handlerRaw as RawHandler,
			ctx,
			definitionMeta,
			capture?.injected,
		);

		const effectiveConfig = capture
			? { ...(config as UnknownRecord), inputSchema: capture.schema }
			: config;

		return originalRegisterTool(toolNameRaw, effectiveConfig, wrapped);
	}) as InstrumentableMcpServer["registerTool"];

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
			// The MCP SDK reads `entry.inputSchema` when it serves `tools/list` and
			// when it validates a call, so reassigning it upgrades the tool in
			// place. This is the schema half of the SDK's own
			// `registeredTool.update({ paramsSchema })`; it deliberately skips the
			// `tools/list_changed` notification that method also sends, because
			// `withWaniwani` runs before `connect()` in every supported call order.
			const capture = captureIntentFor(
				toolName,
				(entry as UnknownRecord).inputSchema,
				ctx,
			);
			if (capture) {
				(entry as UnknownRecord).inputSchema = capture.schema;
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
				capture?.injected,
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
			ctx.funnelSync = await prepareFunnelSyncPayload(flowGraphs);
		}
	}

	return server;
}
