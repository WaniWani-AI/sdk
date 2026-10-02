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
import { classifyCause } from "../session-errors/classify.js";
import type { McpServer } from "../types";
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
import {
	createIntentCapture,
	readFlowTelemetry,
	takeIntentArgument,
} from "./intent-capture.js";
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
	 * Capture why the user came.
	 *
	 * Adds one optional `intent` string to every tool's input schema: a brief
	 * summary of what the user wants and what prompted it, which the calling
	 * model sends only on its first call to the app. It is stripped before the
	 * tool's own handler runs and tracked as `properties.telemetry.intent` on
	 * `tool.called`, beside the tool's own `input`.
	 *
	 * Flow tools keep their own top-level `intent` / `context` arguments; their
	 * values are copied into `properties.telemetry` instead. A tool whose schema
	 * declares its own `intent` keeps it and captures nothing. Pass an object to
	 * narrow capture to specific tools (`tools`) or ask the model to keep PII out
	 * (`omitPII`). Pass `false` to leave every tool schema exactly as declared and
	 * record no intent.
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
	server: McpServer;
	tracker: WaniwaniTracker;
	opts: WithWaniwaniOptions;
	tokenCache: WidgetTokenCache | null;
	injectToken: boolean;
	funnelSync: FunnelSyncPayload | null;
	/** `null` when `captureIntent: false` turns capture off. */
	intentCapture: IntentCapture | null;
};

/**
 * How a wrapped tool yields telemetry, resolved once at registration.
 */
type TelemetryPlan =
	| {
			/** We added `intent` to the schema: strip it from the args and record it. */
			kind: "injected";
			/**
			 * The tool declared no input schema of its own. The MCP SDK calls a
			 * schemaless tool as `handler(extra)` and a schema-carrying one as
			 * `handler(args, extra)`, so the injected schema shifts the call shape
			 * and the tool's own handler still expects the single-argument form.
			 */
			schemaWasAbsent: boolean;
	  }
	| {
			/** A flow tool: copy its own top-level `intent` / `context` into telemetry. */
			kind: "flow";
	  };

type UnknownRecordOrUndefined = UnknownRecord | undefined;

/**
 * Decide how one tool yields telemetry, and extend its schema when we add the
 * argument.
 *
 * Returns `undefined` when the tool records none: capture is off, the tool is
 * outside the allow-list, it declares its own `intent`, or its schema is not
 * an object we can extend. A flow tool (registered with `_meta._flowGraph`)
 * keeps its schema, since it already asks for `intent` and `context`.
 *
 * Both registration orders funnel through here: the intercepted `registerTool`
 * (which puts the schema on the config) and the `_registeredTools` walk (which
 * assigns `entry.inputSchema`).
 */
function planTelemetry(
	toolName: string,
	inputSchema: unknown,
	definitionMeta: UnknownRecordOrUndefined,
	ctx: WrapContext,
): { plan: TelemetryPlan; schema?: unknown } | undefined {
	const capture = ctx.intentCapture;
	if (!capture?.appliesTo(toolName)) {
		return undefined;
	}

	if (isRecord(definitionMeta?._flowGraph)) {
		return { plan: { kind: "flow" } };
	}

	const schema = capture.augment(inputSchema);
	if (schema === undefined) {
		return undefined;
	}

	return {
		plan: {
			kind: "injected",
			schemaWasAbsent: inputSchema === undefined || inputSchema === null,
		},
		schema,
	};
}

function createWrappedHandler(
	toolName: string,
	originalHandler: RawHandler,
	ctx: WrapContext,
	definitionMeta: UnknownRecordOrUndefined,
	telemetryPlan: TelemetryPlan | undefined,
): MaybeWrappedHandler {
	const { server, tracker, opts, tokenCache, injectToken } = ctx;

	const stateUpdateRedactor =
		opts.applyFieldRedactions === true
			? buildStateUpdateRedactor(definitionMeta)
			: undefined;

	// A tool that declared no input schema takes `extra` alone. The injected
	// schema makes the MCP SDK call this wrapper as `(args, extra)`, so restore
	// the single-argument call its handler was written for; a caller that still
	// uses the single-argument shape passes the extra as `input` and nothing else.
	const invokeOriginal: RawHandler =
		telemetryPlan?.kind === "injected" && telemetryPlan.schemaWasAbsent
			? (input, extra) =>
					(originalHandler as unknown as (extra: unknown) => unknown)(
						extra === undefined ? input : extra,
					)
			: originalHandler;

	const wrappedHandler: MaybeWrappedHandler = async (
		input: unknown,
		extra: unknown,
	) => {
		const effectiveOpts = {
			...opts,
			funnelSync: ctx.funnelSync,
			...(stateUpdateRedactor && { redactInput: stateUpdateRedactor }),
		};
		// The injected `intent` is ours, not the tool's: split it off before
		// anything else sees the input, so the handler and the tracked `input` both
		// get exactly the tool's own arguments.
		const { input: toolInput, telemetry } =
			telemetryPlan?.kind === "injected"
				? takeIntentArgument(input)
				: {
						input,
						telemetry:
							telemetryPlan?.kind === "flow"
								? readFlowTelemetry(input)
								: undefined,
					};
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
			const result = await retrievalCollectorStore.run(retrievalCollector, () =>
				invokeOriginal(toolInput, extra),
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
					{ input: toolInput, output: result, telemetry },
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
						cause: classifyCause({ error }),
					},
					clientInfo,
					{ input: toolInput, telemetry },
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
 * Every tool's input schema also gains an optional `intent` argument, which the
 * calling model fills on its first call to the app; it is stripped before the
 * tool's handler runs and tracked as `properties.telemetry.intent` on
 * `tool.called`. Pass `captureIntent: false` to leave tool schemas exactly as
 * declared.
 */
export async function withWaniwani(
	server: McpServer,
	options?: WithWaniwaniOptions,
): Promise<McpServer> {
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

		const telemetry = isRecord(config)
			? planTelemetry(
					toolName,
					(config as UnknownRecord).inputSchema,
					definitionMeta,
					ctx,
				)
			: undefined;

		const wrapped = createWrappedHandler(
			toolName,
			handlerRaw as RawHandler,
			ctx,
			definitionMeta,
			telemetry?.plan,
		);

		const effectiveConfig =
			telemetry?.schema !== undefined
				? { ...(config as UnknownRecord), inputSchema: telemetry.schema }
				: config;

		return originalRegisterTool(toolNameRaw, effectiveConfig, wrapped);
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

			// Only a tool whose handler we wrap gets the argument: the wrapper is what
			// strips it again and restores a schemaless tool's call shape. A task
			// handler (an object, skipped above) keeps its schema as declared.
			//
			// The MCP SDK reads `entry.inputSchema` when it serves `tools/list` and
			// when it validates a call, so reassigning it upgrades the tool in place.
			// This is the schema half of the SDK's own
			// `registeredTool.update({ paramsSchema })`; it skips the
			// `tools/list_changed` notification that method also sends, because
			// `withWaniwani` runs before `connect()` in every supported call order.
			const telemetry = planTelemetry(
				toolName,
				(entry as UnknownRecord).inputSchema,
				definitionMeta,
				ctx,
			);
			if (telemetry?.schema !== undefined) {
				(entry as UnknownRecord).inputSchema = telemetry.schema;
			}

			entry.handler = createWrappedHandler(
				toolName,
				existing,
				ctx,
				definitionMeta,
				telemetry?.plan,
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

	return wrappedServer;
}
