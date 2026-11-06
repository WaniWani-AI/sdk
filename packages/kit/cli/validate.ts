/**
 * The build check.
 *
 * Structural rules first (cheap, from the filesystem), then the modules are
 * actually imported so a broken export or a flow that fails to compile is
 * reported here rather than as a stack trace at request time.
 */

import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { loadAppEnv } from "./env.js";
import {
	allows,
	compare,
	compareVersions,
	floorOf,
	floorVersion,
	installable,
	preferred,
} from "./peers.js";
import { latestVersion } from "./registry.js";
import type { App, Diagnostic, PackageManifest, Report as ReportShape } from "./types.js";

/**
 * The default export of an app module, before anything is known about it.
 *
 * Checking the shape is this file's whole job, so the loader hands back an
 * unopinionated record rather than pretending to know which of `defineTool`,
 * `defineWidget`, `defineEndpoint` or `createFlow` produced it.
 */
type LoadedModule = Record<string, unknown>;

const NAME_RE = /^[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?$/;

/**
 * What may appear in an endpoint path segment. Deliberately narrower than what
 * a filesystem allows: the segment becomes a URL path, and a file called
 * `Book Call.ts` would be served at a URL nobody would guess.
 */
const SEGMENT_RE = /^[a-zA-Z0-9._-]+$/;

const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete", "head", "options"]);

/** Widget names a flow's source passes to `showWidget({ tool })`; the compiled flow does not expose them. */
function widgetsShownBy(flowFile: string): string[] {
	const source = readFileSync(flowFile, "utf-8");
	return [...source.matchAll(/showWidget\(\s*\{[^}]*?tool:\s*["'`]([^"'`]+)["'`]/gs)].map(
		(match) => match[1] as string,
	);
}

/**
 * The `/.well-known/` names the framework serves itself once an app configures
 * OAuth: the protected-resource document a client reads to find the
 * authorization server, and the authorization-server metadata beside it.
 *
 * An app's endpoints are mounted before the framework's, so a file at one of
 * these names wins and the app stops being discoverable — a 200 with the wrong
 * body, which is harder to read than a 404. The kit cannot see whether OAuth is
 * on, because that lives in the template's own `src/server.ts`, so the names are
 * refused whether it is or not. Nothing an app has to say belongs at either of
 * them anyway.
 */
const FRAMEWORK_WELL_KNOWN = new Set(["oauth-authorization-server", "oauth-protected-resource"]);

class Report implements ReportShape {
	readonly root: string;
	readonly errors: Diagnostic[] = [];
	readonly warnings: Diagnostic[] = [];

	constructor(root: string) {
		this.root = root;
	}

	error(where: string, message: string, hint?: string): void {
		this.errors.push({ where, message, hint });
	}

	warn(where: string, message: string, hint?: string): void {
		this.warnings.push({ where, message, hint });
	}

	get ok(): boolean {
		return this.errors.length === 0;
	}
}

function rel(root: string, file: string): string {
	return relative(root, file) || ".";
}

/** Everything the filesystem alone can tell us. */
function checkStructure(app: App, report: Report): void {
	const { root } = app;

	if (!app.configFile) {
		report.error(
			"waniwani.config.ts",
			"missing app config",
			"create waniwani.config.ts with `export default defineApp({ name: '...' })`",
		);
	}

	if (app.tools.length + app.widgets.length + app.flows.length === 0) {
		report.error(
			".",
			"this app exposes nothing",
			"add a tool (tools/<name>.ts), a widget (widgets/<name>/), or a flow (flows/<name>.ts)",
		);
	}

	for (const widget of app.widgets) {
		const where = rel(root, widget.dir);
		if (!widget.contract) {
			report.error(
				where,
				"missing widget.ts",
				"every widget folder needs a widget.ts with `export default defineWidget({ ... })`",
			);
		}
		if (!widget.ui) {
			report.error(
				where,
				"missing ui.tsx",
				"every widget folder needs a ui.tsx with a default-exported React component",
			);
		}
	}

	// Styling is Tailwind, out of the template's `src/index.css`. Nothing imports
	// an app's own CSS, so a styles.css is a file whose rules never load — and it
	// fails in the worst way, by rendering an unstyled widget rather than an
	// error. Naming it here costs one deletion; missing it costs a debugging
	// session against a bundle that never mentions the file.
	for (const file of app.strayStyles) {
		report.error(
			rel(root, file),
			"app CSS is not bundled — nothing imports this file",
			"style with Tailwind utility classes in ui.tsx; the template's src/index.css carries the @theme tokens and the `dark` variant",
		);
	}

	// A widget's folder name is its MCP tool name and its bundle entry name, so
	// it has to survive both.
	const named = [
		...app.tools.map((t) => ({ kind: "tool", name: t.name, where: rel(root, t.file) })),
		...app.widgets.map((w) => ({ kind: "widget", name: w.name, where: rel(root, w.dir) })),
	];

	const seen = new Map<string, (typeof named)[number]>();
	for (const entry of named) {
		if (!NAME_RE.test(entry.name)) {
			report.error(
				entry.where,
				`"${entry.name}" is not a valid MCP tool name`,
				"use lowercase letters, digits, dashes and underscores",
			);
		}
		const previous = seen.get(entry.name);
		if (previous) {
			report.error(
				entry.where,
				`name "${entry.name}" is already taken by ${previous.kind} ${previous.where}`,
				"tool and widget names share one namespace — rename one of them",
			);
		}
		seen.set(entry.name, entry);
	}

	// An endpoint's file position is its URL, so a segment that cannot appear in
	// a URL is a file served somewhere unguessable, and two files resolving to
	// one path means the second mount is dead — Express answers from the first.
	// Both mounts, `api/` and `well-known/`, land in one list and one namespace,
	// because one Express app serves them.
	const paths = new Map<string, string>();
	// The generator names one import per endpoint, camel-cased from the path, so
	// two paths that camel-case alike (`api/cal-slots.ts`, `api/cal/slots.ts`)
	// would emit the same identifier twice and fail in generated code the author
	// cannot open.
	const identifiers = new Map<string, string>();
	for (const endpoint of app.endpoints) {
		const where = rel(root, endpoint.file);

		const identifier = endpoint.segments
			.join("-")
			.replace(/[^a-zA-Z0-9]/g, "")
			.toLowerCase();
		const clash = identifiers.get(identifier);
		if (clash) {
			report.error(
				where,
				`this path generates the same import name as ${clash}`,
				"rename one of the two — the generator derives an identifier from the path",
			);
		}
		identifiers.set(identifier, where);

		for (const segment of endpoint.segments) {
			if (SEGMENT_RE.test(segment)) continue;
			report.error(
				where,
				`"${segment}" cannot be part of a URL path`,
				"use letters, digits, dashes, dots and underscores — the file's position is the endpoint's path",
			);
		}

		const name = endpoint.segments[1];
		if (endpoint.mount === "well-known" && name && FRAMEWORK_WELL_KNOWN.has(name)) {
			report.error(
				where,
				`/.well-known/${name} belongs to the framework's OAuth support`,
				"an app's endpoints mount ahead of the framework's, so this one would answer discovery requests with a body no client can use. Serve the app's own document under a name of its own.",
			);
		}

		const previous = paths.get(endpoint.path);
		if (previous) {
			report.error(
				where,
				`${endpoint.path} is already served by ${previous}`,
				"two files resolve to one path — Express answers from the first, so this one never runs",
			);
		}
		paths.set(endpoint.path, where);
	}

	// Flows point at widgets by name. Catching a typo here beats catching it
	// when a user is halfway through a conversation.
	const widgetNames = new Set(app.widgets.map((w) => w.name));
	for (const flow of app.flows) {
		for (const target of widgetsShownBy(flow.file)) {
			if (!widgetNames.has(target)) {
				report.error(
					rel(root, flow.file),
					`showWidget references the widget "${target}", which does not exist`,
					widgetNames.size > 0
						? `known widgets: ${[...widgetNames].join(", ")}`
						: "this app has no widgets/ folder",
				);
			}
		}
	}
}

/** Import each module and check the shape of what it exports. */
async function checkModules(app: App, report: Report): Promise<void> {
	const { root } = app;

	// Kept for checkSurfaces, which needs the flow ids loaded below.
	let config: LoadedModule | null = null;
	if (app.configFile) {
		const where = rel(root, app.configFile);
		config = await load(app.configFile, where, report);
		if (config && !config.name) {
			report.error(
				where,
				"defineApp() is missing `name`",
				"the MCP server name, e.g. name: 'oney-split-payment'",
			);
		}
		// The field the server's `instructions` comes from is `overview`. A config
		// still carrying the old name would build, register every tool, and serve a
		// server whose instructions are empty, because the generator reads a key
		// that is no longer there.
		if (config && "instructions" in config) {
			report.error(
				where,
				"defineApp() takes `overview`, not `instructions`",
				"rename the key. What belongs under it is what the app is and how its tools fit together; how one tool behaves goes in that tool's own description.",
			);
		}
	}

	for (const tool of app.tools) {
		const where = rel(root, tool.file);
		const def = await load(tool.file, where, report);
		if (!def) continue;
		if (typeof def.run !== "function") {
			report.error(where, "tool is missing run()", "export default defineTool({ ..., run })");
		}
		if (!def.description) {
			report.error(
				where,
				"tool is missing a description",
				"the description is how the model decides to call it — say when to use it",
			);
		}
		if (!def.title) {
			report.warn(where, "tool is missing a title", "titles show up in connector UIs");
		}
	}

	for (const widget of app.widgets) {
		if (!widget.contract) continue;
		const where = rel(root, widget.contract);
		const def = await load(widget.contract, where, report);
		if (!def) continue;
		if (!def.data || typeof def.data !== "object") {
			report.error(
				where,
				"widget is missing a `data` schema",
				"data is the single schema for input, output, and the component's props",
			);
		}
		if (!def.description) {
			report.error(
				where,
				"widget is missing a description",
				"the description is how the model decides to show it",
			);
		}
	}

	for (const endpoint of app.endpoints) {
		const where = rel(root, endpoint.file);
		const def = await load(endpoint.file, where, report);
		if (!def) continue;
		if (typeof def.handler !== "function") {
			report.error(
				where,
				"endpoint is missing handler()",
				"export default defineEndpoint({ handler: (req, res) => { ... } })",
			);
		}
		for (const method of (def.method ? [def.method].flat() : []) as string[]) {
			if (HTTP_METHODS.has(method)) continue;
			report.error(
				where,
				`"${method}" is not an HTTP method`,
				`one of: ${[...HTTP_METHODS].join(", ")}`,
			);
		}
	}

	// Flow id (what a surface names) to source file (where showWidget calls are read).
	const flowFiles = new Map<string, string>();
	for (const flow of app.flows) {
		const where = rel(root, flow.file);
		const def = await load(flow.file, where, report);
		if (!def) continue;
		if (!def.name || !def.config || typeof def.handler !== "function") {
			report.error(
				where,
				"this is not a compiled flow",
				"export default createFlow({ ... }).addEdge(...).compile()",
			);
		}
		if (typeof def.name === "string") flowFiles.set(def.name, flow.file);
	}

	if (config && app.configFile) {
		checkSurfaces(app, rel(root, app.configFile), config, flowFiles, report);
	}
}

// Same name as the runtime's SURFACE_ENV; the CLI does not import the runtime.
const SURFACE_ENV = "WANIWANI_SURFACE";

const SURFACE_KINDS = ["flows", "tools", "widgets"] as const;

/** Every id a surface names must exist, and the active WANIWANI_SURFACE must be declared. */
function checkSurfaces(
	app: App,
	where: string,
	config: LoadedModule,
	flowFiles: Map<string, string>,
	report: Report,
): void {
	const surfaces = config.surfaces ?? {};
	if (typeof surfaces !== "object" || surfaces === null || Array.isArray(surfaces)) {
		report.error(
			where,
			"`surfaces` must be an object of named surfaces",
			'surfaces: { chatgpt: { flows: ["motor_quote"], overview: "..." } }',
		);
		return;
	}

	const known = {
		flows: new Set(flowFiles.keys()),
		tools: new Set(app.tools.map((t) => t.name)),
		widgets: new Set(app.widgets.map((w) => w.name)),
	};

	for (const [name, surface] of Object.entries(surfaces as Record<string, unknown>)) {
		if (typeof surface !== "object" || surface === null || Array.isArray(surface)) {
			report.error(
				where,
				`surfaces.${name} must be an object`,
				"{ flows?: string[], tools?: string[], widgets?: string[], overview?: string }",
			);
			continue;
		}
		const entry = surface as Record<string, unknown>;

		let listed = 0;
		for (const kind of SURFACE_KINDS) {
			const ids = entry[kind];
			if (ids === undefined) continue;
			if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) {
				report.error(where, `surfaces.${name}.${kind} must be an array of strings`);
				continue;
			}
			listed += ids.length;
			for (const id of ids as string[]) {
				if (known[kind].has(id)) continue;
				report.error(
					where,
					`surfaces.${name}.${kind} names "${id}", which does not exist`,
					known[kind].size > 0
						? `known ${kind}: ${[...known[kind]].join(", ")}`
						: `this app has no ${kind}`,
				);
			}
		}

		// A kept flow still shows its widgets; dropping one breaks the flow midway.
		const kept = new Set(Array.isArray(entry.widgets) ? (entry.widgets as string[]) : []);
		for (const flowId of Array.isArray(entry.flows) ? (entry.flows as string[]) : []) {
			const file = flowFiles.get(flowId);
			if (!file) continue;
			for (const target of widgetsShownBy(file)) {
				if (kept.has(target) || !known.widgets.has(target)) continue;
				report.error(
					where,
					`surfaces.${name} keeps the flow "${flowId}" but not the widget "${target}" it shows`,
					`add "${target}" to surfaces.${name}.widgets`,
				);
			}
		}

		if (entry.overview !== undefined && typeof entry.overview !== "string") {
			report.error(where, `surfaces.${name}.overview must be a string`);
		}

		if (listed === 0) {
			report.error(
				where,
				`surfaces.${name} exposes nothing`,
				"name at least one flow, tool or widget; every list is an allowlist, and a list left out means none of that kind",
			);
		}
	}

	// Empty counts as unset, as at runtime.
	const active = process.env[SURFACE_ENV];
	if (active && !Object.hasOwn(surfaces, active)) {
		const declared = Object.keys(surfaces);
		report.error(
			where,
			`${SURFACE_ENV}="${active}" names no declared surface`,
			declared.length > 0
				? `declared: ${declared.join(", ")}. The server refuses to start under this environment.`
				: "the config declares no surfaces. Unset the variable to serve the whole app.",
		);
	}
}

/**
 * App modules are TypeScript, and they import each other with the `.js`
 * specifiers TypeScript's ESM output requires — `../lib/plans.js` for a file on
 * disk called `plans.ts`. Node's built-in type stripping does not remap those,
 * so validation registers tsx's resolver before importing anything out of the
 * app folder. Bun does the remapping on its own, which is what hid this while
 * the CLI still ran under bun.
 *
 * Registration is global to the process and idempotent here, so it happens once
 * on the first load rather than at startup — `waniwani start` never validates.
 */
let resolverRegistered = false;
async function registerTypeScriptResolver(): Promise<void> {
	if (resolverRegistered) return;
	resolverRegistered = true;
	const { register } = await import("tsx/esm/api");
	register();
}

async function load(file: string, where: string, report: Report): Promise<LoadedModule | null> {
	try {
		await registerTypeScriptResolver();
		const module = (await import(`${file}?t=${Date.now()}`)) as { default?: LoadedModule };
		const def = module.default;
		if (!def) {
			report.error(where, "no default export", "the runtime loads this module's default export");
			return null;
		}
		return def;
	} catch (error) {
		report.error(where, "failed to load", error instanceof Error ? error.message : String(error));
		return null;
	}
}

/**
 * The SDK version an app asked for, against the floor this package declares.
 *
 * `@waniwani/sdk` is a required peer (see the manifest's `//sdk` note), so the
 * app owns the version and this is the one place that says what the runtime and
 * the pinned template need underneath it. It reads two manifests off disk and
 * fetches nothing, which is why it runs in `check` rather than waiting for the
 * dependency merge in `codegen.ts` — a version that cannot work should not
 * need a template download to be told so.
 *
 * Undeclared is not an error. npm and bun both install a required peer, and
 * `codegen.ts` writes one into the generated project, so an app that never
 * mentions the SDK still gets a working copy.
 */
async function checkPeers(app: App, report: Report): Promise<void> {
	let manifest: PackageManifest;
	try {
		manifest = JSON.parse(readFileSync(join(app.root, "package.json"), "utf-8")) as PackageManifest;
	} catch {
		// No manifest, or an unparseable one. Both are `init`'s business, and
		// neither is improved by a second error about a dependency inside it.
		return;
	}

	const name = "@waniwani/sdk";
	const spec = manifest.dependencies?.[name] ?? manifest.devDependencies?.[name];
	if (spec == null) {
		return;
	}

	const floor = floorOf(name);
	const suggestion = installable(name);
	switch (compare(spec, name)) {
		case "below":
			report.error(
				"package.json",
				`${name} ${spec} cannot reach ${floor}, which this kit needs`,
				`no version that range allows will work: below the floor a flow drops every answer the user gives before its question and asks it again, and neverPrefilled() does not exist to keep a consent or a widget pick out of the model's reach; below 0.24.0 a flow tool lists its whole state schema to reviewers and lets the model write any field of it, including ones a node computes; below 0.23.0 every tool also asks the model for a nested telemetry object on each user message, which OpenAI's plugin guidelines rule out; below 0.22.1 a flow this kit registers loses its flow graph, and below 0.21.1 npm refuses the tree outright. Set ${name} to ${suggestion}.`,
			);
			break;
		case "prerelease":
			report.warn(
				"package.json",
				`${name} ${spec} is a prerelease, and ${floor} does not accept one`,
				`npm and bun both exclude a prerelease from a range that names none, so the install warns and the tree may not be what this spec says. Deliberate is fine; ${suggestion} is the released floor.`,
			);
			break;
		case "reachable":
			report.warn(
				"package.json",
				`${name} ${spec} also allows versions below ${floor}`,
				`a fresh install resolves above the floor, and a lockfile written before it moved can hold this tree below it. ${suggestion} says the floor out loud.`,
			);
			break;
		default:
			// "ok", and "unknown" for an expression this cannot parse — a
			// workspace protocol or a git URL, where the version is not in the
			// string and guessing at it would be a false alarm either way.
			break;
	}

	await checkSdkFreshness(spec, report);
}

/**
 * An app whose SDK range stopped below what npm publishes.
 *
 * The check above measures a range against this package's floor, and a floor is
 * the wrong instrument for this question: a caret written at the floor clears
 * that floor forever, including on the day two further minors have shipped.
 * Under semver's 0.x rule a caret stops at the next minor, so an SDK minor never
 * reaches an app on its own and nobody upstream can push it there. Somebody has
 * to say so, and this is the only place that runs in front of the person who can
 * act.
 *
 * A warning rather than an error, and silent whenever the answer is not certain:
 * no registry answer, a range this module cannot read, a `latest` the kit's own
 * floor would not accept, or an app already sitting above what npm serves. See
 * `latestVersion` in `./registry.js` for what it costs, which after the first
 * lookup of the day is a file read.
 */
async function checkSdkFreshness(spec: string, report: Report): Promise<void> {
	const name = "@waniwani/sdk";
	const latest = await latestVersion(name);
	if (!latest || allows(spec, latest)) return;

	// Ahead of the registry rather than behind it: a prerelease, or a version
	// published and then unpublished. Nothing to say.
	const current = floorVersion(spec);
	if (!current || compareVersions(latest, current) !== 1) return;

	// `preferred` refuses a `latest` this kit cannot endorse — a different major,
	// or one below the declared floor — and hands back the floor instead. That is
	// not a suggestion worth printing.
	const suggestion = preferred(name, latest);
	if (suggestion === installable(name)) return;

	report.warn(
		"package.json",
		`${name} ${spec} is behind ${latest}`,
		`npm serves ${latest} as latest and this range stops below it. The SDK is 0.x, so a minor is a breaking change and no install will cross one on its own — set ${name} to ${suggestion} when you want it.`,
	);
}

/**
 * A `vercel.json` at the app root, when the kit's build output needs none.
 *
 * A deploy config that names a build command is the dangerous half: it overrides
 * the one Vercel would pick, and the command it names is a build this kit no
 * longer performs. The staging command is called out by name because it is what
 * a build wrote into every app repo before the tree moved to the app root, and
 * it now deletes the tree it used to place: `waniwani build` stages
 * `.vercel/output`, then the `rm -rf` in that command removes it and the `cp`
 * fails on a source that is gone.
 *
 * Anything else in the file is the app's own business — a `maxDuration`, a
 * region, a cron — so this warns and never fails.
 */
function checkDeployConfig(app: App, report: Report): void {
	const file = join(app.root, "vercel.json");
	if (!existsSync(file)) return;

	let config: { buildCommand?: unknown; routes?: unknown };
	try {
		config = JSON.parse(readFileSync(file, "utf-8")) as typeof config;
	} catch {
		report.warn("vercel.json", "is not valid JSON", "Vercel fails the build before it starts.");
		return;
	}

	const command = typeof config.buildCommand === "string" ? config.buildCommand : "";
	if (command.includes(".waniwani/.vercel/output")) {
		report.warn(
			"vercel.json",
			"stages the build output itself, and the build already does",
			"`waniwani build` leaves the tree at `.vercel/output`, so this command's `rm -rf` deletes it and its `cp` fails on a source that no longer exists. Drop the field: `framework: null` is the only key this file needs.",
		);
		return;
	}
	if (command) {
		report.warn(
			"vercel.json",
			`overrides the build command with ${JSON.stringify(command)}`,
			"Vercel runs this instead of the `build` script in package.json, which is what runs `waniwani build`. Drop the field unless the app genuinely builds differently.",
		);
	}
	if (Array.isArray(config.routes)) {
		report.warn(
			"vercel.json",
			"carries a `routes` table",
			"the build's own routing config already sends `/api/*` at the server, and a top-level `routes` entry replaces Vercel's whole routing phase rather than adding to it.",
		);
	}
}

export async function validateApp(app: App): Promise<Report> {
	// The check imports every server-safe module for real, and a module that
	// builds a client at import time reads the environment while doing it. An app
	// that runs fine would otherwise fail its own build check over a variable
	// sitting in the file next to it.
	loadAppEnv(app.root);
	const report = new Report(app.root);
	checkStructure(app, report);
	await checkPeers(app, report);
	checkDeployConfig(app, report);
	// Importing broken modules produces noise on top of structural errors.
	if (report.ok) {
		await checkModules(app, report);
	}
	return report;
}
