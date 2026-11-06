/**
 * The shared MCP runtime.
 *
 * Every Waniwani MCP app runs this exact code. App repos contain no server
 * bootstrap, so a runtime fix is one package bump away for all of them — no
 * 30-repo sweep, no per-repo verification.
 *
 * The server itself belongs to the distribution template, which constructs it,
 * registers whatever tools it ships, and runs it. The CLI generates one file
 * against that seam — `src/waniwani.ts` — which imports the app's modules and
 * hands them to `registerApp()`. Nothing else.
 */

import cors from "cors";
import express, { type ErrorRequestHandler, type RequestHandler } from "express";
import type { McpServer, ToolMeta, ViewName } from "skybridge/server";
import { type DocsApp, type DocsEntry, docsHandler } from "./docs.js";
import type {
	EndpointDefinition,
	Shape,
	SurfaceConfig,
	ToolContext,
	ToolHints,
	WidgetCsp,
} from "./index.js";
import { narrow, SURFACE_ENV } from "./surface.js";

// The generated `waniwani.ts` imports this from `@waniwani/kit/server`.
export { resolveSurface } from "./surface.js";

/**
 * The manifest holds definitions with unrelated schemas side by side, so the
 * handler signatures are widened here. `never` in the parameter position
 * accepts any concrete handler; the call sites cast back.
 */
type AnyToolDefinition = {
	title: string;
	description: string;
	input?: Shape;
	output?: Shape;
	hints?: ToolHints;
	run: (input: never, context: ToolContext) => unknown;
};

type AnyWidgetDefinition = {
	title: string;
	description: string;
	data: Shape;
	hints?: ToolHints;
	csp?: WidgetCsp;
	autoHeight?: boolean;
	llmText?: (data: never) => string;
	load?: (input: never) => unknown;
};

/** A flow compiled by `createFlow(...).compile()` from `@waniwani/sdk/mcp`. */
export type CompiledFlow = {
	name: string;
	// biome-ignore lint/suspicious/noExplicitAny: the SDK's own tool config shape
	config: any;
	// biome-ignore lint/suspicious/noExplicitAny: the SDK's own handler shape
	handler: any;
};

export type Manifest = {
	tools: Array<{ name: string; def: AnyToolDefinition }>;
	widgets: Array<{ name: string; def: AnyWidgetDefinition }>;
	flows: CompiledFlow[];
	/**
	 * HTTP endpoints, each with the path its file position produced — `/api/...`
	 * from `api/`, `/.well-known/...` from `well-known/`. The runtime mounts a
	 * path, so nothing here cares which folder it came from.
	 */
	endpoints?: Array<{ path: string; def: EndpointDefinition }>;
	/**
	 * Origins the template's Tailwind entry loads from, read off it at build
	 * time. Every view imports that stylesheet, so every widget needs them.
	 */
	styleDomains?: string[];
	/** From `resolveSurface()`. Absent: the whole manifest is registered. */
	surface?: SurfaceConfig;
	/**
	 * The server's identity, for the `/docs` page's heading and overview. The
	 * generated `waniwani.ts` passes the object it constructs the server from, so
	 * `instructions` is the overview the active surface serves.
	 */
	app?: DocsApp;
	/** `false` leaves `/docs` unmounted. Anything else serves it. */
	docs?: boolean;
};

/**
 * The origins a widget may load assets from: its own, plus the ones its
 * stylesheet needs.
 *
 * A host that enforces the widget CSP drops undeclared requests silently — a
 * blocked webfont is not an error, just a fallback face — so the base
 * stylesheet's origins are added for every widget rather than left to each app
 * to remember. An app's own `csp` is additive, never overwritten.
 */
function resourceDomains(csp: WidgetCsp | undefined, styleDomains: string[]) {
	const merged = [...new Set([...(csp?.resourceDomains ?? []), ...styleDomains])];
	return merged.length > 0 ? merged : undefined;
}

/**
 * The `_meta` a widget's tool carries.
 *
 * A chat host that frames widgets at a height of its own choosing reads
 * `ui.autoHeight` to size the frame from the widget's content instead, so a
 * card taller than that frame is neither clipped nor scrolled inside it. Hosts
 * that do not read it ignore the key, and the framework merges
 * `ui.resourceUri` into this same object when it registers the view.
 *
 * The cast is because `ui` is typed for the keys the MCP Apps spec defines,
 * and `autoHeight` is a host extension rather than one of them.
 */
function widgetMeta(autoHeight: boolean | undefined): ToolMeta {
	return { ui: { autoHeight: autoHeight !== false } } as unknown as ToolMeta;
}

/**
 * Translate `hints` into MCP annotations. `title` is always present because
 * Claude's Connectors Directory rejects tools without one.
 */
function annotations(title: string, hints: ToolHints | undefined, defaults: ToolHints) {
	const merged = { ...defaults, ...hints };
	return {
		title,
		readOnlyHint: merged.readOnly ?? false,
		destructiveHint: merged.destructive ?? false,
		openWorldHint: merged.openWorld ?? false,
		idempotentHint: merged.idempotent ?? false,
	};
}

/** Normalise whatever a tool handler returned into an MCP `CallToolResult`. */
function toolResult(value: unknown) {
	if (typeof value === "string") {
		return { content: [{ type: "text" as const, text: value }] };
	}
	if (value && typeof value === "object" && "content" in value) {
		return value as { content: Array<{ type: "text"; text: string }> };
	}
	const structuredContent = (value ?? {}) as Record<string, unknown>;
	return {
		structuredContent,
		content: [{ type: "text" as const, text: JSON.stringify(structuredContent, null, 2) }],
	};
}

/**
 * Default model-facing text for a widget. Widgets render their own detail, so
 * the model is told to stop narrating it — the single most common cause of a
 * widget being read aloud twice.
 */
function defaultWidgetText(name: string) {
	return `The ${name} widget is now rendered for the user. It displays all the detail itself — do NOT list or repeat its contents in text. Acknowledge it in one short sentence, then wait for the user to interact with it.`;
}

function widgetError(name: string, error: unknown) {
	const message = error instanceof Error ? error.message : String(error);
	console.error(`[waniwani] widget "${name}" failed to load:`, error);
	return {
		isError: true as const,
		content: [
			{
				type: "text" as const,
				text: `The ${name} widget could not load its data (${message}). Tell the user something went wrong on our side and offer to try again — do not invent the data.`,
			},
		],
	};
}

/**
 * Answer anything outside the declared methods with 405 rather than running the
 * handler. An endpoint is mounted with `use()`, which matches every method, so
 * without this a `GET /api/cal/book` would reach a handler written for a POST
 * body and fail somewhere less obvious.
 */
function methodGuard(allowed: string[]): RequestHandler {
	// A preflight never carries the real method, and answering it 405 blocks the
	// request it was asking about.
	const pass = new Set([...allowed, "OPTIONS"]);

	return (req, res, next) => {
		if (pass.has(req.method)) return next();
		res.setHeader("Allow", allowed.join(", "));
		res.status(405).json({ error: `${req.method} not allowed` });
	};
}

/**
 * The last link in every endpoint's chain: a 4-arity middleware, which is how
 * Express recognises an error handler.
 *
 * Scoped to the endpoint's own mount path rather than the app, so it cannot
 * catch anything the endpoint did not cause. Without it a rejected handler — or
 * a malformed JSON body, which the parser reports the same way — reaches
 * Express's default handler and answers an HTML error page to a `fetch()` that
 * is waiting for JSON.
 */
function endpointErrorHandler(path: string): ErrorRequestHandler {
	return (error, _req, res, next) => {
		console.error(`[waniwani] endpoint "${path}" failed:`, error);
		if (res.headersSent) return next(error);
		// `express.json()` rejects a malformed body with a 400 already on the error.
		const status =
			typeof (error as { status?: unknown })?.status === "number"
				? (error as { status: number }).status
				: 500;
		res.status(status).json({
			error: error instanceof Error ? error.message : "Internal server error",
		});
	};
}

/**
 * Mount an app's HTTP endpoints on the server's Express app.
 *
 * Everything the framework does not do for us is done here, once, rather than
 * left to each endpoint to remember: CORS (a widget calls from another origin),
 * a JSON body parser (the framework installs none, so `req.body` would be
 * `undefined`), the method guard, and the error envelope.
 */
function registerEndpoints(server: McpServer, endpoints: NonNullable<Manifest["endpoints"]>): void {
	for (const { path, def } of endpoints) {
		const methods = def.method ? [def.method].flat().map((m) => m.toUpperCase()) : undefined;

		const chain: Array<RequestHandler | ErrorRequestHandler> = [];
		// The preflight answer names the methods the guard below actually accepts.
		// Browsers cache it, so advertising a method that then answers 405 is a
		// contradiction the widget author has to debug twice.
		if (def.cors !== false) chain.push(cors(methods ? { methods } : undefined));
		if (def.json !== false) chain.push(express.json());
		if (methods) chain.push(methodGuard(methods));
		chain.push(def.handler, endpointErrorHandler(path));

		// The error handler's arity is what makes Express treat it as one, and
		// `use()` is typed for request handlers only.
		server.use(path, ...(chain as RequestHandler[]));
	}
}

/**
 * What `/docs` lists: each definition as it is registered below, annotations
 * included, so the page and `tools/list` agree.
 */
function docsModel(served: Manifest, oauth: boolean | undefined) {
	const entry = (
		name: string,
		def: { title: string; description: string; hints?: ToolHints },
		input: Shape | undefined,
		defaults: ToolHints,
	): DocsEntry => ({
		name,
		title: def.title,
		description: def.description,
		input,
		annotations: annotations(def.title, def.hints, defaults),
	});

	return {
		app: served.app,
		oauth,
		tools: served.tools.map(({ name, def }) => entry(name, def, def.input, { readOnly: false })),
		widgets: served.widgets.map(({ name, def }) => entry(name, def, def.data, { readOnly: true })),
		flows: served.flows.map(
			(flow): DocsEntry => ({
				name: flow.name,
				title: flow.config?.title ?? flow.config?.annotations?.title,
				description: flow.config?.description,
				input: flow.config?.inputSchema,
				annotations: flow.config?.annotations,
			}),
		),
	};
}

/**
 * Whether the server was constructed with an `oauth` provider, which puts
 * `/mcp` behind a bearer token. The framework sets the flag in its constructor,
 * so it holds by the time an app registers, but keeps it off its public type.
 * `undefined` when a framework version stops carrying it.
 */
function oauthEnabled(server: McpServer): boolean | undefined {
	const flag = (server as unknown as { oauthEnabled?: unknown }).oauthEnabled;
	return typeof flag === "boolean" ? flag : undefined;
}

/**
 * Register an app's tools, widgets and flows onto a server the template built.
 *
 * The template owns construction, its own tools, `withWaniwani`, and `run()`.
 * This adds to that server rather than replacing it, so a tool the template
 * ships reaches every app built on it — one publish, not thirty edits — and an
 * app's own tools sit alongside it.
 */
export async function registerApp(server: McpServer, manifest: Manifest): Promise<McpServer> {
	const served = manifest.surface ? narrow(manifest, manifest.surface) : manifest;
	const { tools, widgets, flows, endpoints = [], styleDomains = [] } = served;
	if (manifest.surface) {
		console.info(
			`[waniwani] surface ${process.env[SURFACE_ENV]}: ${flows.length} flow(s), ${tools.length} tool(s), ${widgets.length} widget(s) registered`,
		);
	}

	// Before the tools, because Express matches in registration order and the
	// framework mounts `/mcp` and its OAuth metadata after this function returns.
	// The ordering is the reason an endpoint is reachable at all, and it is also
	// why `waniwani check` refuses the two `/.well-known/` names the framework
	// serves itself: a mount here wins, so a clash would be an app answering
	// discovery rather than a 404 anybody could read.
	registerEndpoints(server, endpoints);

	// Mounted here for the same ordering reason, from the narrowed lists, so a
	// surface's page shows that surface. No app endpoint can take the path:
	// endpoints live under `/api/` and `/.well-known/`.
	if (manifest.docs !== false) {
		server.express.get("/docs", docsHandler(docsModel(served, oauthEnabled(server))));
	}

	// Widgets: one `data` schema drives the input schema, the structured output,
	// and the type the component receives.
	//
	// A widget is a tool with a view attached. The view's component name is the
	// widget's folder name, which is also the name of the entry the generator
	// writes into `src/views/` — one name, from the filesystem, so a widget
	// cannot be registered against a component that was never bundled.
	for (const { name, def } of widgets) {
		server.registerTool(
			{
				name,
				title: def.title,
				description: def.description,
				inputSchema: def.data,
				outputSchema: def.data,
				annotations: annotations(def.title, def.hints, { readOnly: true }),
				_meta: widgetMeta(def.autoHeight),
				view: {
					component: name as ViewName,
					description: def.description,
					csp: {
						...def.csp,
						resourceDomains: resourceDomains(def.csp, styleDomains),
					},
				},
			},
			async (input) => {
				try {
					const data = (def.load ? await def.load(input as never) : input) as Record<
						string,
						unknown
					>;
					return {
						structuredContent: data,
						content: [
							{
								type: "text" as const,
								text: def.llmText?.(data as never) ?? defaultWidgetText(name),
							},
						],
					};
				} catch (error) {
					return widgetError(name, error);
				}
			},
		);
	}

	for (const { name, def } of tools) {
		server.registerTool(
			{
				name,
				title: def.title,
				description: def.description,
				inputSchema: def.input ?? {},
				outputSchema: def.output,
				annotations: annotations(def.title, def.hints, { readOnly: false }),
			},
			async (input, extra) => {
				try {
					return toolResult(await def.run(input as never, { meta: extra._meta ?? {} }));
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					console.error(`[waniwani] tool "${name}" failed:`, error);
					return {
						isError: true as const,
						content: [
							{
								type: "text" as const,
								text: `The ${name} tool failed (${message}). Tell the user it did not work and offer to retry — do not invent a result.`,
							},
						],
					};
				}
			},
		);
	}

	// Flows arrive from the SDK shaped for the MCP SDK's `(name, config, handler)`
	// call, which the framework replaced with a single config carrying the name.
	for (const flow of flows) {
		server.registerTool({ ...flow.config, name: flow.name }, flow.handler);
	}

	// `withWaniwani` is deliberately not called here. It wraps every registered
	// handler in place, so it has to run after the last registration — which is
	// the template's, not this function's. `src/server.ts` calls it.
	return server;
}
