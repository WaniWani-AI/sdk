/**
 * The `/docs` page every app serves: a human-readable account of what its MCP
 * server registers, for anyone who needs a URL to point at rather than an MCP
 * client to connect with.
 *
 * It is rendered from the same definitions `registerApp` hands the framework,
 * after surface narrowing, so the page lists what this deployment's `tools/list`
 * lists from the app and nothing it does not.
 *
 * The markup is built at runtime and sent as a response, never written into an
 * app's files. Every interpolated value goes through `html`, which escapes it
 * unless it is a fragment `html` itself produced, so a description holding
 * markup reaches the page as text.
 */

import type { Request, RequestHandler } from "express";
import { z } from "zod";

/** What the page says about the server itself. */
export type DocsApp = {
	name: string;
	title?: string;
	version?: string;
	/** The overview the server hands the model at `initialize`, surface applied. */
	instructions?: string;
};

/** The MCP annotations a registered tool carries, as far as the page shows them. */
export type DocsAnnotations = {
	readOnlyHint?: boolean;
	destructiveHint?: boolean;
	openWorldHint?: boolean;
	idempotentHint?: boolean;
};

/** One registered tool, widget or flow. */
export type DocsEntry = {
	name: string;
	title?: string;
	description?: string;
	/** A Zod shape, or a Zod object schema: whatever the tool registered as `inputSchema`. */
	input?: unknown;
	annotations?: DocsAnnotations;
};

export type DocsModel = {
	app?: DocsApp;
	/**
	 * Whether `/mcp` sits behind OAuth. `undefined` when the framework does not
	 * say, and the page then says nothing about sign-in rather than guess.
	 */
	oauth?: boolean;
	tools: DocsEntry[];
	widgets: DocsEntry[];
	flows: DocsEntry[];
};

// ------------------------------------------------------------------- escaping

/** Markup `html` produced, and so already escaped. */
class Html {
	constructor(readonly value: string) {}
}

type Part = Html | string | number | boolean | null | undefined | Part[];

const ENTITIES: Record<string, string> = {
	"&": "&amp;",
	"<": "&lt;",
	">": "&gt;",
	'"': "&quot;",
	"'": "&#39;",
};

function escapeText(value: string): string {
	return value.replace(/[&<>"']/g, (char) => ENTITIES[char] as string);
}

function flatten(part: Part): string {
	if (part instanceof Html) return part.value;
	if (Array.isArray(part)) return part.map(flatten).join("");
	if (part === null || part === undefined || part === false || part === true) return "";
	return escapeText(String(part));
}

/** Tagged template: literal markup passes through, every interpolation is escaped. */
function html(strings: TemplateStringsArray, ...parts: Part[]): Html {
	let out = strings[0] as string;
	for (let i = 0; i < parts.length; i++) {
		out += flatten(parts[i]) + (strings[i + 1] as string);
	}
	return new Html(out);
}

// ----------------------------------------------------------------- parameters

type JsonSchema = {
	type?: string | string[];
	description?: string;
	default?: unknown;
	enum?: unknown[];
	const?: unknown;
	format?: string;
	items?: JsonSchema;
	anyOf?: JsonSchema[];
	oneOf?: JsonSchema[];
	properties?: Record<string, JsonSchema>;
	required?: string[];
	$ref?: string;
};

type Parameter = {
	name: string;
	type: string;
	required: boolean;
	description?: string;
	default?: unknown;
};

/** Nested object fields are listed as `parent.child` down to this depth. */
const MAX_DEPTH = 3;

function isZodSchema(value: unknown): value is z.ZodType {
	return typeof value === "object" && value !== null && "_zod" in value;
}

/**
 * The JSON Schema a client receives for this input, read the way the MCP SDK
 * reads it for `tools/list`: the input side of any transform or default.
 *
 * `null` when the schema cannot be represented, so the page says so for that
 * one entry instead of failing to render.
 */
function inputSchema(input: unknown): JsonSchema | null {
	if (input === undefined) return {};
	try {
		const schema = isZodSchema(input) ? input : z.object(input as z.ZodRawShape);
		return z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }) as JsonSchema;
	} catch {
		return null;
	}
}

/** A schema value as JSON, or as plain text for one JSON cannot hold. */
function literal(value: unknown): string {
	try {
		return JSON.stringify(value) ?? String(value);
	} catch {
		return String(value);
	}
}

function typeLabel(schema: JsonSchema): string {
	if (schema.const !== undefined) return literal(schema.const);
	if (Array.isArray(schema.enum)) return schema.enum.map(literal).join(" | ");
	const union = schema.anyOf ?? schema.oneOf;
	if (union) return union.map(typeLabel).join(" | ");
	if (schema.type === "array") {
		const item = typeLabel(schema.items ?? {});
		return item.includes(" | ") ? `(${item})[]` : `${item}[]`;
	}
	if (Array.isArray(schema.type)) return schema.type.join(" | ");
	if (schema.type) return schema.format ? `${schema.type} (${schema.format})` : schema.type;
	return schema.$ref ? "object" : "any";
}

/** The object schema whose fields are listed under a parameter, if it has one. */
function nestedObject(schema: JsonSchema): { schema: JsonSchema; suffix: string } | undefined {
	if (schema.properties) return { schema, suffix: "." };
	if (schema.type === "array" && schema.items?.properties) {
		return { schema: schema.items, suffix: "[]." };
	}
	return undefined;
}

function parameters(schema: JsonSchema, prefix = "", depth = 0): Parameter[] {
	const required = new Set(schema.required ?? []);
	return Object.entries(schema.properties ?? {}).flatMap(([key, property]) => {
		const name = prefix + key;
		const row: Parameter = {
			name,
			type: typeLabel(property),
			required: required.has(key),
			description: property.description,
			default: property.default,
		};
		const nested = depth < MAX_DEPTH ? nestedObject(property) : undefined;
		return nested ? [row, ...parameters(nested.schema, name + nested.suffix, depth + 1)] : [row];
	});
}

// ------------------------------------------------------------------ rendering

type Kind = "tool" | "widget" | "flow";

const SECTIONS: Array<{ kind: Kind; key: "tools" | "widgets" | "flows"; heading: string }> = [
	{ kind: "tool", key: "tools", heading: "Tools" },
	{ kind: "widget", key: "widgets", heading: "Widgets" },
	{ kind: "flow", key: "flows", heading: "Flows" },
];

const HINTS: Array<{ key: keyof DocsAnnotations; label: string }> = [
	{ key: "readOnlyHint", label: "read-only" },
	{ key: "destructiveHint", label: "destructive" },
	{ key: "idempotentHint", label: "idempotent" },
	{ key: "openWorldHint", label: "open world" },
];

function anchor(kind: Kind, name: string): string {
	return `${kind}-${name}`;
}

function parameterTable(entry: DocsEntry): Html {
	const schema = inputSchema(entry.input);
	if (schema === null) {
		return html`<p class="muted">The input schema cannot be shown as JSON Schema.</p>`;
	}
	const rows = parameters(schema);
	if (rows.length === 0) return html`<p class="muted">No parameters.</p>`;
	return html`<div class="params"><table>
<thead><tr><th>Parameter</th><th>Type</th><th>Required</th><th>Description</th></tr></thead>
<tbody>${rows.map(
		(row) => html`
<tr><td><code>${row.name}</code></td><td><code>${row.type}</code></td><td>${row.required ? "yes" : "no"}</td><td>${row.description ?? ""}${
			row.default !== undefined
				? html`${row.description ? " " : ""}<span class="muted">Default: <code>${literal(row.default)}</code></span>`
				: ""
		}</td></tr>`,
	)}
</tbody>
</table></div>`;
}

/**
 * A flow gets no parameter table. Its input is the flow protocol (an action, a
 * session id, and an untyped `stateUpdates` object holding the fields the flow
 * last asked for), which the assistant fills in turn by turn and a reader has
 * no use for.
 */
function entryCard(kind: Kind, entry: DocsEntry): Html {
	const hints = HINTS.filter(({ key }) => entry.annotations?.[key] === true);
	return html`
<article id="${anchor(kind, entry.name)}">
<h3>${entry.title ?? entry.name}</h3>
<p class="meta"><code>${entry.name}</code>${hints.map(({ label }) => html` <span class="badge badge-${label.replace(" ", "-")}">${label}</span>`)}</p>
${entry.description ? html`<p class="text">${entry.description}</p>` : ""}
${kind === "flow" ? "" : parameterTable(entry)}
</article>`;
}

/** The sign-in line under the URL, absent when the model does not know. */
function signIn(oauth: boolean | undefined): Html {
	if (oauth === undefined) return html``;
	return oauth
		? html`<p><strong>Sign-in:</strong> required. The server uses OAuth 2.0, so your client opens a sign-in page the first time it connects.</p>`
		: html`<p><strong>Sign-in:</strong> none. The server answers without an account or an API key.</p>`;
}

/** What a reader does with the URL, and what happens once they have. */
function howItWorks(model: DocsModel): Html {
	const results = [
		"The answer comes back in the conversation.",
		model.widgets.length > 0
			? "Widgets show an interactive view in clients that support MCP Apps, such as ChatGPT and Claude."
			: "",
		model.flows.length > 0
			? "A flow takes you through a longer task one question at a time, and the assistant keeps track of your answers."
			: "",
	].filter(Boolean);
	return html`<section>
<h2>How it works</h2>
<ol>
<li>Add the server to your AI client with the URL above.${model.oauth ? " Sign in when the client asks you to." : ""}</li>
<li>Ask for what you need in plain language. The assistant reads the tools listed below and calls the one that fits.</li>
<li>${results.join(" ")}</li>
</ol>
</section>`;
}

const STYLE = `
:root{color-scheme:light dark;--bg:#fff;--fg:#1a1a1a;--muted:#5f6368;--line:#e3e3e3;--card:#fafafa;--code:#f1f1f1;--accent:#2d5bd7;--warn:#b3261e}
@media (prefers-color-scheme:dark){:root{--bg:#121212;--fg:#ececec;--muted:#a0a4a8;--line:#2e2e2e;--card:#1a1a1a;--code:#262626;--accent:#8ab0ff;--warn:#f2b8b5}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:880px;margin:0 auto;padding:40px 16px 64px}
h1{font-size:28px;margin:0 0 4px}h2{font-size:20px;margin:40px 0 12px;padding-bottom:6px;border-bottom:1px solid var(--line)}h3{font-size:17px;margin:0 0 4px}
a{color:var(--accent)}
code,pre{font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}
code{background:var(--code);padding:1px 5px;border-radius:4px;overflow-wrap:anywhere}
pre{background:var(--code);padding:12px 14px;border-radius:8px;overflow-x:auto;margin:8px 0}
pre code{background:none;padding:0}
.muted,.meta{color:var(--muted)}
.text{white-space:pre-wrap}
article{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px 18px;margin:12px 0}
.badge{display:inline-block;font-size:12px;border:1px solid var(--line);border-radius:999px;padding:0 8px;margin-left:4px}
.badge-destructive{color:var(--warn);border-color:currentColor}
.params{overflow-x:auto;margin-top:8px}
table{width:100%;border-collapse:collapse;font-size:14px}
th,td{text-align:left;vertical-align:top;padding:6px 10px 6px 0;border-top:1px solid var(--line)}
th{font-weight:600;border-top:none}
td code{overflow-wrap:normal}
td:first-child code{white-space:nowrap}
nav ul{margin:8px 0 0;padding-left:20px}
ol li{margin:4px 0}
footer{margin-top:48px;font-size:13px}
`;

/**
 * Everything on the page except the server's own URL, which depends on the
 * request. Rendered once, because the definitions do not change while the
 * server runs.
 */
function renderBody(model: DocsModel): { title: string; head: Html; access: Html; tail: Html } {
	const title = model.app?.title ?? model.app?.name ?? "MCP server";
	const present = SECTIONS.filter(({ key }) => model[key].length > 0);

	const head = html`<header>
<h1>${title}</h1>
<p class="meta">${model.app?.name ? html`<code>${model.app.name}</code>` : ""}${model.app?.version ? html` version ${model.app.version}` : ""}</p>
</header>`;

	const tail = html`
${howItWorks(model)}
${
	model.app?.instructions
		? html`<section>
<h2>Overview</h2>
<p class="text">${model.app.instructions}</p>
</section>`
		: ""
}
${
	present.length > 0
		? html`<nav>
<h2>Contents</h2>
<ul>${present.map(
				({ kind, key, heading }) => html`
<li>${heading} (${model[key].length})<ul>${model[key].map(
					(entry) =>
						html`<li><a href="#${anchor(kind, entry.name)}">${entry.title ?? entry.name}</a></li>`,
				)}</ul></li>`,
			)}
</ul>
</nav>`
		: html`<p class="muted">This server registers no tools, widgets or flows of its own.</p>`
}
${present.map(
	({ kind, key, heading }) => html`
<section>
<h2>${heading}</h2>
${model[key].map((entry) => entryCard(kind, entry))}
</section>`,
)}
<footer class="muted">Generated from the definitions this server registers.</footer>`;

	return { title, head, access: signIn(model.oauth), tail };
}

/**
 * This server's public origin, the way the framework resolves it for view URLs
 * and OAuth metadata: `x-forwarded-host` first, then `Host`, first hop of a
 * forwarded chain only. A forwarded host with no forwarded protocol is https;
 * a bare `localhost` or `127.0.0.1` host is http.
 */
function serverOrigin(req: Request): string {
	const firstHop = (value: string | undefined) => value?.split(",")[0]?.trim();
	const forwardedHost = firstHop(req.get("x-forwarded-host"));
	if (forwardedHost) {
		const proto = firstHop(req.get("x-forwarded-proto")) || "https";
		return `${proto}://${forwardedHost}`;
	}
	const host = req.get("host");
	if (host) {
		const local = ["localhost:", "127.0.0.1:"].some((prefix) => host.startsWith(prefix));
		return `${local ? "http" : "https"}://${host}`;
	}
	return `http://localhost:${process.env.__PORT || "3000"}`;
}

/**
 * The `GET /docs` handler. The page carries no script, and its CSP says so, so
 * even markup that escaped escaping could not run.
 */
export function docsHandler(model: DocsModel): RequestHandler {
	// A definition the page cannot render costs the page, never the server start.
	let body: ReturnType<typeof renderBody>;
	try {
		body = renderBody(model);
	} catch (error) {
		console.error("[waniwani] the /docs page could not be rendered:", error);
		return (_req, res) => {
			res.status(500).type("text/plain").send("The documentation page could not be rendered.");
		};
	}
	const { title, head, access, tail } = body;

	return (req, res) => {
		const endpoint = `${serverOrigin(req)}/mcp`;
		const page = html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · MCP documentation</title>
<style>${new Html(STYLE)}</style>
</head>
<body>
<main>
${head}
<section>
<h2>Connect</h2>
<p>Add this URL to your AI client as a remote MCP server. In Claude, open Customize, then Connectors, and choose Add custom connector. ChatGPT and other MCP clients take the same URL.</p>
<pre><code>${endpoint}</code></pre>
${access}
<p class="muted">Transport: Streamable HTTP, with JSON-RPC requests sent as <code>POST</code>.</p>
</section>
${tail}
</main>
</body>
</html>
`;
		res.setHeader("Content-Type", "text/html; charset=utf-8");
		res.setHeader(
			"Content-Security-Policy",
			"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
		);
		res.setHeader("X-Content-Type-Options", "nosniff");
		res.setHeader("Cache-Control", "public, max-age=300");
		res.send(page.value);
	};
}
