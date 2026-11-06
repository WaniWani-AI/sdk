/**
 * The Waniwani MCP authoring API.
 *
 * This is everything an app author imports. There is no server bootstrap, no
 * transport, no MCP wiring, no build config in an app repo — the runtime owns
 * all of it (see `./server.ts`) and the CLI generates the glue (see `../cli/`).
 *
 * An app is a folder:
 *
 *   waniwani.config.ts          defineApp({ ... })
 *   tools/<name>.ts             export default defineTool({ ... })
 *   widgets/<name>/widget.ts    export default defineWidget({ ... })
 *   widgets/<name>/ui.tsx       export default function Component() { ... }
 *   flows/<name>.ts             export default createFlow({ ... }).compile()
 *   api/<path>.ts               export default defineEndpoint({ ... })
 */

import type { RequestHandler } from "express";
import type { z } from "zod";

/** A Zod object shape — `{ name: z.string() }`, not `z.object({ ... })`. */
export type Shape = z.ZodRawShape;

/** The TypeScript type a `Shape` describes. */
export type Infer<S extends Shape> = z.infer<z.ZodObject<S>>;

/**
 * Behavioural hints handed to the host LLM. The runtime translates these into
 * MCP `annotations` and always fills in the `title` that Claude's Connectors
 * Directory requires, so an app repo cannot get that wrong.
 */
export type ToolHints = {
	/** The tool only reads. Defaults to `true` for widgets, `false` for tools. */
	readOnly?: boolean;
	/** The tool can destroy data. */
	destructive?: boolean;
	/** The tool reaches out to the open internet. */
	openWorld?: boolean;
	/** Calling twice with the same input has the same effect as calling once. */
	idempotent?: boolean;
};

// ---------------------------------------------------------------- app config

/**
 * What an app may set on the template's `search` tool.
 *
 * Declared here and again in the template's `src/search/index.ts`, on purpose:
 * the template does not depend on this package, so there is no type to share.
 * The two meet at the generated `waniwani.ts` and nowhere else, which makes this
 * a mirror that has to be kept in step by hand. A field added on one side and
 * not the other is silently dropped rather than reported.
 */
export type SearchOptions = {
	/**
	 * Whether the template registers the tool at all.
	 *
	 * `false` is the only way an app can decline it, because it cannot unregister
	 * what the template has already registered. Worth using: a deployment with no
	 * corpus behind it, or one holding another market's documents, is better off
	 * without the tool than with one answering confidently out of the wrong file.
	 */
	enabled?: boolean;
	/** Passages to ask for, 1-20. Unset leaves the SDK's default of 5. */
	topK?: number;
	/**
	 * Similarity floor, 0-1, under which a passage is dropped rather than ranked
	 * last. Unset leaves the SDK's default of 0.3.
	 */
	minScore?: number;
	/**
	 * Exact-match filter on chunk metadata: a passage must carry all of these
	 * pairs to come back. With the corpus tagged at ingest time, this is a gate in
	 * code rather than a line of prompt.
	 */
	metadata?: Record<string, string>;
	/** Give up on a slow search and answer as though nothing matched. */
	timeoutMs?: number;
	/** Name the source document on each passage. */
	includeSources?: boolean;
	/**
	 * Framing prepended to the answer text. Retrieved passages are third-party
	 * text on its way into a prompt; this is where an app says they are reference
	 * material rather than instructions.
	 */
	preamble?: string;
	/**
	 * The whole answer for the case where no passage comes back — nothing
	 * matched, the search outran `timeoutMs`, or the knowledge base failed.
	 *
	 * The template's default is English and says only that the corpus does not
	 * cover the question. An app whose knowledge base carries regulated
	 * information needs both halves of the reply in its own words: the refusal the
	 * user reads, and the human to go to instead — a support line, a broker, a
	 * claims number. This is the one reply the tool has no passages behind, which
	 * makes it the one the model is most tempted to answer from pre-training, so
	 * it is worth writing rather than inheriting.
	 *
	 * `preamble` is not applied on top of it. That text frames retrieved passages
	 * as reference material, and an empty result has none to frame.
	 */
	notFound?: string;
	/**
	 * Status text the host shows while the call is in flight, and once it has
	 * returned. Configurable because the defaults are English and this string is
	 * one of the few a user actually reads.
	 */
	invoking?: string;
	invoked?: string;
};

/** The event categories the tracking backend recognises. */
export type ToolType = "pricing" | "product_info" | "availability" | "support" | "other";

/**
 * Tracking options, forwarded whole to the SDK's `withWaniwani()`.
 *
 * A mirror of that function's options for the same reason as `SearchOptions`
 * above, narrowed to what an app declares rather than constructs: the SDK also
 * accepts a `client` instance and an `onError` callback, and neither belongs in a
 * config file.
 *
 * `flushAfterToolCall` is the one that matters on serverless. An invocation
 * frozen between tool calls takes any unsent event batch with it, and this is
 * the only way an app can ask for the flush.
 */
export type TrackingOptions = {
	/** One category for every tool, or a function mapping tool name to category. */
	toolType?: ToolType | ((toolName: string) => ToolType | undefined);
	/** Merged into every tracked event. */
	metadata?: Record<string, unknown>;
	/** Flush the tracking transport after each tool call. */
	flushAfterToolCall?: boolean;
	/**
	 * Put widget tracking config in each tool response's `_meta.waniwani`, so a
	 * widget in the browser can send its own events.
	 *
	 * @default true
	 */
	injectWidgetToken?: boolean;
	/**
	 * Field names to strip from location `_meta` before events are sent. Pass
	 * `["latitude", "longitude"]` to drop coordinates and keep the rest.
	 *
	 * @default []
	 */
	stripLocationFields?: readonly string[];
	/**
	 * Replace flow state fields marked with `redacted()` before they are tracked.
	 * Wire it to an env var to keep real values in development and redact in
	 * production.
	 *
	 * @default false
	 */
	applyFieldRedactions?: boolean;
	/**
	 * Ask the model why the user came. Every tool gains one optional `intent`
	 * string, sent on the model's first call to the app, stripped before the
	 * handler runs and tracked on `tool.called`; flows keep their own `intent`
	 * and `context`. Pass `{ omitPII: true }` to ask the model to keep personal
	 * data out of it, `{ tools }` to limit it to some tools, or `false` to leave
	 * every tool schema as declared.
	 *
	 * @default true
	 */
	captureIntent?: boolean | { tools?: readonly string[]; omitPII?: boolean };
};

/**
 * A subset of the app for one deployment. Each list is an allowlist; a list
 * left out means none of that kind. Endpoints are always served.
 */
export type SurfaceConfig = {
	/** Flow ids (`createFlow({ id })`), not filenames. */
	flows?: string[];
	/** Tool filenames without extension. */
	tools?: string[];
	/** Widget folder names. */
	widgets?: string[];
	/** Replaces the app's `overview` while this surface is active. */
	overview?: string;
};

export type AppConfig = {
	/** MCP server name, e.g. `oney-split-payment`. */
	name: string;
	/** Shown to humans in connector UIs. */
	title?: string;
	/** Defaults to the app `package.json` version. */
	version?: string;
	/**
	 * What this app is and how its tools fit together, handed to the host LLM
	 * once in the `initialize` handshake: which tool to reach for, what order
	 * things happen in, how to read what comes back, tone, guardrails.
	 *
	 * How a single tool behaves belongs in that tool's own `description`, not
	 * here. A description travels with every `tools/list` and reaches the model
	 * at the moment it is choosing that tool. This text is read once at connect,
	 * so a client that connected before an edit keeps the old copy until it
	 * reconnects, and a host is free to drop it altogether. Nothing load-bearing
	 * survives in it.
	 *
	 * Reaches the wire as the MCP server's `instructions`.
	 */
	overview?: string;
	/**
	 * Tune, or decline, the `search` tool the template ships. Reaches the
	 * template through the generated `waniwani.ts`; a template that ships no such
	 * tool ignores it.
	 */
	search?: SearchOptions;
	/** Tracking behaviour for every tool call this app serves. */
	tracking?: TrackingOptions;
	/**
	 * Named subsets, selected per deployment by `WANIWANI_SURFACE`. Unset or
	 * empty serves everything; an undeclared name refuses to start.
	 */
	surfaces?: Record<string, SurfaceConfig>;
	/**
	 * Serve the HTML page at `/docs` that lists this deployment's tools,
	 * widgets and flows, their parameters, and the URL to connect an MCP client
	 * to. On by default, and served without authentication: `false` is for a
	 * server whose tool list should only reach a client that signed in.
	 */
	docs?: boolean;
};

export function defineApp(config: AppConfig): AppConfig {
	return config;
}

// ---------------------------------------------------------------------- tools

/**
 * What a tool handler may return. A string becomes the model-facing text; an
 * object becomes `structuredContent` plus a JSON text fallback. Returning a
 * full MCP `CallToolResult` is still allowed for the rare tool that needs it.
 */
export type ToolResult =
	| string
	| Record<string, unknown>
	| { content: Array<{ type: "text"; text: string }>; structuredContent?: Record<string, unknown> };

/** What a tool's `run` gets besides its input. */
export type ToolContext = {
	/**
	 * The `_meta` the host sent with this call: session and visitor ids, the
	 * user's locale, anything a chat embed adds. Empty when the host sent none.
	 */
	meta: Record<string, unknown>;
};

export type ToolDefinition<S extends Shape = Shape, R extends ToolResult = ToolResult> = {
	title: string;
	/** LLM-facing. When to call this, and what it does. */
	description: string;
	input?: S;
	output?: Shape;
	hints?: ToolHints;
	run: (input: Infer<S>, context: ToolContext) => R | Promise<R>;
};

export function defineTool<S extends Shape, R extends ToolResult>(
	def: ToolDefinition<S, R>,
): ToolDefinition<S, R> {
	return def;
}

// -------------------------------------------------------------------- widgets

export type WidgetCsp = {
	/** Domains the widget may `fetch()`. */
	connectDomains?: string[];
	/** Domains the widget may load images/fonts/scripts from. */
	resourceDomains?: string[];
	/**
	 * Domains the widget may open externally (a CTA's `openExternal`) without
	 * the host interposing its safe-link confirmation modal.
	 */
	redirectDomains?: string[];
};

/**
 * A widget contract. This file is imported by *both* the server and the
 * browser bundle, so it must stay free of React and CSS — the component lives
 * next to it in `ui.tsx`.
 *
 * `data` is the single schema for the widget: it is the tool's input schema,
 * its output schema, and the type `useWidget()` hands the component. One
 * schema, so server and UI cannot drift.
 */
export type WidgetDefinition<S extends Shape = Shape> = {
	title: string;
	/** LLM-facing. When to show this widget, and how to frame it. */
	description: string;
	data: S;
	hints?: ToolHints;
	csp?: WidgetCsp;
	/**
	 * Let the host size the widget's frame to its own content, rather than to a
	 * frame height the host picked. On by default.
	 *
	 * A card whose height depends on its data — a quote, a list, a picker — is
	 * cut off or padded out by any fixed frame, and the host has no way to know
	 * how tall the content came out. Set it to `false` for a widget that renders
	 * its own scroll area and wants to keep the host's frame.
	 */
	autoHeight?: boolean;
	/**
	 * Text handed to the model alongside the rendered widget. Use it to tell
	 * the model what NOT to repeat, and what to wait for.
	 */
	llmText?: (data: Infer<S>) => string;
	/**
	 * Optional server-side loader, for widgets whose data comes from an API
	 * rather than from the model. Defaults to echoing the input through.
	 */
	load?: (input: Infer<S>) => Infer<S> | Promise<Infer<S>>;
};

export function defineWidget<S extends Shape>(def: WidgetDefinition<S>): WidgetDefinition<S> {
	return def;
}

// ------------------------------------------------------------------ endpoints

/**
 * HTTP methods an endpoint can be restricted to. `undefined` accepts every
 * method, which is what an Express `use()` mount does.
 */
export type HttpMethod = "get" | "post" | "put" | "patch" | "delete" | "head" | "options";

/**
 * A plain HTTP endpoint served by the same server as the MCP tools.
 *
 * This exists for the browser and for other machines, not for the model. A
 * widget runs in a cross-origin iframe and can `fetch()` its own server at
 * `window.skybridge.serverUrl` — for a booking, a price lookup, a webhook
 * receiver — and the model never sees the call. Anything the *model* should be
 * able to reach belongs in `tools/`, not here.
 *
 * The path comes from the file's location, prefix included, from either of the
 * two folders that mount one:
 *
 *   api/cal/slots.ts                  →  /api/cal/slots
 *   well-known/openai-apps-challenge.ts  →  /.well-known/openai-apps-challenge
 *
 * `well-known/` is for the names other people's specs assign at the root of a
 * domain — an ownership challenge, a `security.txt`. A handler reads
 * `process.env`, which is what a token that differs per environment needs.
 */
export type EndpointDefinition = {
	/**
	 * Restrict the endpoint to these methods, answering anything else with 405.
	 * Defaults to accepting every method.
	 */
	method?: HttpMethod | HttpMethod[];
	/**
	 * Answer cross-origin requests, preflight included. On by default: a widget
	 * is served from a different origin than the server it calls, so an endpoint
	 * without CORS is one the widget cannot reach.
	 */
	cors?: boolean;
	/**
	 * Parse a JSON request body into `req.body`. On by default — the framework
	 * installs no body parser of its own, so an endpoint without this reads
	 * `req.body` as `undefined`.
	 */
	json?: boolean;
	/** An Express handler. Throwing is safe: the runtime answers 500 and logs. */
	handler: RequestHandler;
};

export function defineEndpoint(def: EndpointDefinition): EndpointDefinition {
	return def;
}
