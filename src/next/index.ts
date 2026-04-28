import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { InitializeNextJsInIframe } from "../mcp/react/components/initialize-next-in-iframe";
import {
	getManifestFilePath,
	WANIWANI_WIDGET_BASE_URL_PLACEHOLDER,
	WANIWANI_WIDGETS_MANIFEST_RELATIVE_PATH,
	type WaniwaniWidgetsManifest,
} from "../mcp/server/resources/widget-manifest";

type Header = {
	key: string;
	value: string;
};

type HeaderRoute = {
	source: string;
	headers: Header[];
};

type WebpackContext = {
	dev?: boolean;
	isServer?: boolean;
};

type NextConfigObject = {
	env?: Record<string, string | undefined>;
	headers?: () => HeaderRoute[] | Promise<HeaderRoute[]>;
	webpack?: (config: unknown, context: WebpackContext) => unknown;
	turbopack?: Record<string, unknown>;
	outputFileTracingIncludes?: Record<string, string[]>;
	[key: string]: unknown;
};

type NextConfigFactory = (
	...args: unknown[]
) => NextConfigObject | Promise<NextConfigObject>;

export type WithWaniwaniWidgetsOptions = {
	/** Resource module that contains createResource(...) calls. */
	resources: string;
	/** Project root. Defaults to process.cwd(). */
	projectRoot?: string;
	/** Next app directory. Defaults to ./app. */
	appDir?: string;
	/** Global CSS imported into every generated widget entry. Defaults to ./app/globals.css when present. */
	globalCss?: string | false;
};

type DiscoveredResource = {
	id: string;
	htmlPath: string;
	stableHtmlPath: string;
	prebuilt: boolean;
};

type WidgetBuildTarget = DiscoveredResource & {
	assetBase: string;
	pagePath: string;
	layoutPaths: string[];
};

const BUILD_ARG = "__waniwani_build_widgets";
const builtKeys = new Set<string>();

export function withWaniwaniWidgets<
	T extends NextConfigObject | NextConfigFactory,
>(nextConfig: T, options: WithWaniwaniWidgetsOptions): T {
	if (typeof nextConfig === "function") {
		return ((...args: unknown[]) => {
			const result = nextConfig(...args);
			if (
				result &&
				typeof (result as Promise<NextConfigObject>).then === "function"
			) {
				return (result as Promise<NextConfigObject>).then((config) =>
					enhanceNextConfig(config, options),
				);
			}
			return enhanceNextConfig(result as NextConfigObject, options);
		}) as T;
	}

	return enhanceNextConfig(nextConfig, options) as T;
}

function enhanceNextConfig(
	nextConfig: NextConfigObject,
	options: WithWaniwaniWidgetsOptions,
): NextConfigObject {
	const projectRoot = resolve(options.projectRoot ?? process.cwd());
	const resources = discoverResources(projectRoot, options.resources);
	const manifest = createManifest(resources);
	writeManifestFile(projectRoot, manifest);
	const originalHeaders = nextConfig.headers;
	const originalWebpack = nextConfig.webpack;
	const manifestTraceTarget = `./${WANIWANI_WIDGETS_MANIFEST_RELATIVE_PATH}`;
	const existingTracingIncludes = nextConfig.outputFileTracingIncludes ?? {};

	return {
		...nextConfig,
		// Empty `turbopack` key signals to Next.js 16 that the consumer is
		// aware their config touches both bundlers; without it Next errors out
		// when the user runs Turbopack with a custom `webpack()` hook.
		turbopack: { ...(nextConfig.turbopack ?? {}) },
		outputFileTracingIncludes: {
			...existingTracingIncludes,
			"/**/*": [
				...(existingTracingIncludes["/**/*"] ?? []),
				manifestTraceTarget,
			],
		},
		async headers() {
			buildWidgetsSync(projectRoot, options);
			const existing = originalHeaders ? await originalHeaders() : [];
			return [
				...existing,
				{
					source: "/widgets/:path*",
					headers: [
						{
							key: "Cache-Control",
							value: "public, max-age=0, must-revalidate",
						},
						{
							key: "Access-Control-Allow-Origin",
							value: "*",
						},
					],
				},
			];
		},
		webpack(config: unknown, context: WebpackContext) {
			if (context.isServer) {
				buildWidgetsSync(projectRoot, options);
			}
			return originalWebpack ? originalWebpack(config, context) : config;
		},
	};
}

function writeManifestFile(
	projectRoot: string,
	manifest: WaniwaniWidgetsManifest,
): void {
	const manifestPath = getManifestFilePath(projectRoot);
	mkdirSync(dirname(manifestPath), { recursive: true });
	writeFileSync(manifestPath, JSON.stringify(manifest));
}

function buildWidgetsSync(
	projectRoot: string,
	options: WithWaniwaniWidgetsOptions,
): void {
	if (process.env.WANIWANI_WIDGETS_SKIP_BUILD === "1") {
		return;
	}

	const key = JSON.stringify({ projectRoot, options });
	if (builtKeys.has(key)) {
		return;
	}
	builtKeys.add(key);

	const payload = Buffer.from(
		JSON.stringify({ ...options, projectRoot }),
		"utf8",
	).toString("base64");
	const result = spawnSync(
		process.execPath,
		[fileURLToPath(import.meta.url), BUILD_ARG, payload],
		{
			cwd: projectRoot,
			stdio: "inherit",
			env: process.env,
		},
	);

	if (result.status !== 0) {
		throw new Error(
			`WaniWani widget build failed with exit code ${result.status ?? "unknown"}`,
		);
	}
}

async function buildWaniwaniWidgets(
	options: WithWaniwaniWidgetsOptions,
): Promise<void> {
	const projectRoot = resolve(options.projectRoot ?? process.cwd());
	const resources = discoverResources(projectRoot, options.resources);
	const targets = resources
		.filter((resource) => !resource.prebuilt)
		.map((resource) => resolveBuildTarget(projectRoot, options, resource));

	if (targets.length === 0) {
		return;
	}

	const cacheDir = resolve(projectRoot, "node_modules/.cache/waniwani/widgets");
	const publicWidgetsDir = resolve(projectRoot, "public/widgets");
	mkdirSync(cacheDir, { recursive: true });
	mkdirSync(publicWidgetsDir, { recursive: true });

	const [{ build }, react, tailwindcss] = await Promise.all([
		import("vite"),
		import("@vitejs/plugin-react"),
		import("@tailwindcss/vite"),
	]);

	for (const target of targets) {
		const entryPath = writeGeneratedEntry(
			projectRoot,
			cacheDir,
			options,
			target,
		);
		const assetBase = target.assetBase;

		rmSync(resolve(projectRoot, "public", `${assetBase}.js`), { force: true });
		rmSync(resolve(projectRoot, "public", `${assetBase}.css`), { force: true });

		await build({
			root: projectRoot,
			configFile: false,
			publicDir: false,
			logLevel: "warn",
			plugins: [react.default(), tailwindcss.default()],
			css: {
				postcss: {
					plugins: [],
				},
			},
			resolve: {
				alias: [{ find: "@", replacement: projectRoot }],
			},
			define: {
				"process.env.NODE_ENV": JSON.stringify("production"),
			},
			build: {
				cssCodeSplit: false,
				emptyOutDir: false,
				minify: true,
				outDir: publicWidgetsDir,
				rollupOptions: {
					input: entryPath,
					output: {
						assetFileNames: (assetInfo) => {
							if (assetInfo.names.some((name) => name.endsWith(".css"))) {
								return `${stripWidgetsPrefix(assetBase)}.css`;
							}
							return `${stripWidgetsPrefix(assetBase)}-[name][extname]`;
						},
						chunkFileNames: `${stripWidgetsPrefix(assetBase)}.js`,
						codeSplitting: false,
						entryFileNames: `${stripWidgetsPrefix(assetBase)}.js`,
					},
				},
				sourcemap: false,
				target: "es2020",
			},
		});

		writeWidgetHtml(projectRoot, target);
	}
}

function discoverResources(
	projectRoot: string,
	resourcesPath: string,
): DiscoveredResource[] {
	const absolutePath = resolveProjectPath(projectRoot, resourcesPath);
	const source = readFileSync(absolutePath, "utf8");
	const resources: DiscoveredResource[] = [];

	for (const objectSource of findCreateResourceObjects(source)) {
		const id = readStringProperty(objectSource, "id");
		if (!id) {
			throw new Error(
				`WaniWani widgets: createResource in ${resourcesPath} must use a string literal id.`,
			);
		}

		const htmlPath = readStringProperty(objectSource, "htmlPath") ?? `/${id}`;
		const stableHtmlPath = toStableHtmlPath(id, htmlPath);
		resources.push({
			id,
			htmlPath,
			stableHtmlPath,
			prebuilt: isStableWidgetHtmlPath(htmlPath),
		});
	}

	return resources;
}

function findCreateResourceObjects(source: string): string[] {
	const objects: string[] = [];
	let index = 0;

	while (index < source.length) {
		const callIndex = source.indexOf("createResource", index);
		if (callIndex === -1) {
			break;
		}

		let openParen = callIndex + "createResource".length;
		while (/\s/.test(source[openParen] ?? "")) {
			openParen++;
		}
		if (source[openParen] !== "(") {
			index = openParen + 1;
			continue;
		}
		const openBrace = source.indexOf("{", openParen);
		if (openBrace === -1) {
			index = callIndex + "createResource".length;
			continue;
		}

		const closeBrace = findMatchingBrace(source, openBrace);
		if (closeBrace === -1) {
			throw new Error("WaniWani widgets: could not parse createResource call.");
		}

		objects.push(source.slice(openBrace, closeBrace + 1));
		index = closeBrace + 1;
	}

	return objects;
}

function findMatchingBrace(source: string, openBrace: number): number {
	let depth = 0;
	let quote: '"' | "'" | "`" | null = null;
	let escaped = false;
	let lineComment = false;
	let blockComment = false;

	for (let index = openBrace; index < source.length; index++) {
		const char = source[index];
		const next = source[index + 1];

		if (lineComment) {
			if (char === "\n") {
				lineComment = false;
			}
			continue;
		}

		if (blockComment) {
			if (char === "*" && next === "/") {
				blockComment = false;
				index++;
			}
			continue;
		}

		if (quote) {
			if (escaped) {
				escaped = false;
			} else if (char === "\\") {
				escaped = true;
			} else if (char === quote) {
				quote = null;
			}
			continue;
		}

		if (char === "/" && next === "/") {
			lineComment = true;
			index++;
			continue;
		}

		if (char === "/" && next === "*") {
			blockComment = true;
			index++;
			continue;
		}

		if (char === '"' || char === "'" || char === "`") {
			quote = char;
			continue;
		}

		if (char === "{") {
			depth++;
		} else if (char === "}") {
			depth--;
			if (depth === 0) {
				return index;
			}
		}
	}

	return -1;
}

function readStringProperty(
	source: string,
	propertyName: string,
): string | null {
	const pattern = new RegExp(
		`(?:^|[,\\n\\r])\\s*${propertyName}\\s*:\\s*(["'\`])([^"'\`]+)\\1`,
	);
	const match = source.match(pattern);
	return match?.[2] ?? null;
}

function createManifest(
	resources: DiscoveredResource[],
): WaniwaniWidgetsManifest {
	const byId: Record<string, string> = {};
	const byHtmlPath: Record<string, string> = {};

	for (const resource of resources) {
		byId[resource.id] = resource.stableHtmlPath;
		byHtmlPath[resource.htmlPath] = resource.stableHtmlPath;
	}

	return {
		version: 1,
		byId,
		byHtmlPath,
	};
}

function resolveBuildTarget(
	projectRoot: string,
	options: WithWaniwaniWidgetsOptions,
	resource: DiscoveredResource,
): WidgetBuildTarget {
	const appDir = resolveProjectPath(projectRoot, options.appDir ?? "app");
	const routePath = normalizeRoutePath(resource.htmlPath);
	const page = findPageForRoute(appDir, routePath);

	if (!page) {
		throw new Error(
			`WaniWani widgets: could not find a Next.js page for ${resource.htmlPath} under ${relative(
				projectRoot,
				appDir,
			)}.`,
		);
	}

	return {
		...resource,
		assetBase: resource.stableHtmlPath.slice(0, -".html".length),
		pagePath: page.pagePath,
		layoutPaths: page.layoutPaths,
	};
}

function findPageForRoute(
	appDir: string,
	routePath: string,
): { pagePath: string; layoutPaths: string[] } | null {
	const pages: Array<{ pagePath: string; routePath: string }> = [];
	collectPages(appDir, appDir, pages);

	const matches = pages.filter((page) => page.routePath === routePath);
	if (matches.length === 0) {
		return null;
	}
	if (matches.length > 1) {
		throw new Error(
			`WaniWani widgets: multiple Next.js pages match ${routePath}: ${matches
				.map((match) => match.pagePath)
				.join(", ")}`,
		);
	}

	const pagePath = matches[0].pagePath;
	return {
		pagePath,
		layoutPaths: collectLayouts(appDir, dirname(pagePath)),
	};
}

function collectPages(
	appDir: string,
	currentDir: string,
	pages: Array<{ pagePath: string; routePath: string }>,
): void {
	for (const entry of readdirSync(currentDir).sort()) {
		const absolutePath = join(currentDir, entry);
		const stat = statSync(absolutePath);
		if (stat.isDirectory()) {
			collectPages(appDir, absolutePath, pages);
			continue;
		}
		if (!/^page\.(tsx|ts|jsx|js)$/.test(entry)) {
			continue;
		}
		pages.push({
			pagePath: absolutePath,
			routePath: routePathForPage(appDir, absolutePath),
		});
	}
}

function routePathForPage(appDir: string, pagePath: string): string {
	const relativeDir = relative(appDir, dirname(pagePath));
	const segments = relativeDir
		.split(/[\\/]/)
		.filter(Boolean)
		.filter((segment) => !isRouteGroup(segment))
		.filter((segment) => !segment.startsWith("@"));

	return `/${segments.join("/")}`.replace(/\/$/, "") || "/";
}

function collectLayouts(appDir: string, pageDir: string): string[] {
	const relativeDir = relative(appDir, pageDir);
	const segments = relativeDir.split(/[\\/]/).filter(Boolean);
	const layouts: string[] = [];
	let currentDir = appDir;

	for (const segment of segments) {
		currentDir = join(currentDir, segment);
		const layout = findRouteFile(currentDir, "layout");
		if (layout) {
			layouts.push(layout);
		}
	}

	return layouts;
}

function findRouteFile(dir: string, basename: string): string | null {
	for (const extension of ["tsx", "ts", "jsx", "js"]) {
		const candidate = join(dir, `${basename}.${extension}`);
		if (existsSync(candidate)) {
			return candidate;
		}
	}
	return null;
}

function writeGeneratedEntry(
	projectRoot: string,
	cacheDir: string,
	options: WithWaniwaniWidgetsOptions,
	target: WidgetBuildTarget,
): string {
	const entryPath = resolve(cacheDir, `${safeFileName(target.id)}.tsx`);
	const entryDir = dirname(entryPath);
	const globalCssPath = resolveGlobalCss(projectRoot, options.globalCss);
	const layoutImports = target.layoutPaths
		.map(
			(layoutPath, index) =>
				`import Layout${index} from ${JSON.stringify(importPath(entryDir, layoutPath))};`,
		)
		.join("\n");
	const layoutWraps = target.layoutPaths
		.map(
			(_, index) =>
				`\tchildren = <Layout${target.layoutPaths.length - index - 1}>{children}</Layout${target.layoutPaths.length - index - 1}>;`,
		)
		.join("\n");
	const fallbackProvider =
		target.layoutPaths.length === 0
			? "\tchildren = <WidgetProvider loading={<LoadingWidget />}>{children}</WidgetProvider>;"
			: "";

	writeFileSync(
		entryPath,
		[
			'import React from "react";',
			'import { createRoot } from "react-dom/client";',
			target.layoutPaths.length === 0
				? 'import { LoadingWidget, WidgetProvider } from "@waniwani/sdk/mcp/react";'
				: "",
			globalCssPath
				? `import ${JSON.stringify(importPath(entryDir, globalCssPath))};`
				: "",
			`import Page from ${JSON.stringify(importPath(entryDir, target.pagePath))};`,
			layoutImports,
			"",
			"function Widget() {",
			"\tlet children = <Page />;",
			layoutWraps,
			fallbackProvider,
			"\treturn children;",
			"}",
			"",
			'createRoot(document.getElementById("root")!).render(<Widget />);',
			"",
		]
			.filter((line) => line !== "")
			.join("\n"),
	);

	return entryPath;
}

function writeWidgetHtml(projectRoot: string, target: WidgetBuildTarget): void {
	const assetBase = target.assetBase;
	// `assetBase` is rooted at "/" (e.g. "/widgets/comparison"); strip the
	// leading slash so `path.resolve` doesn't treat it as an absolute path
	// and discard the `projectRoot` + "public" segments.
	const cssPath = resolve(
		projectRoot,
		"public",
		`${assetBase.replace(/^\//, "")}.css`,
	);
	const htmlPath = resolve(
		projectRoot,
		"public",
		target.stableHtmlPath.slice(1),
	);
	const initMarkup = renderToStaticMarkup(
		createElement(InitializeNextJsInIframe, {
			baseUrl: WANIWANI_WIDGET_BASE_URL_PLACEHOLDER,
		}),
	);
	const cssTag = existsSync(cssPath)
		? `<link rel="stylesheet" href="${WANIWANI_WIDGET_BASE_URL_PLACEHOLDER}${assetBase}.css">`
		: "";

	mkdirSync(dirname(htmlPath), { recursive: true });
	writeFileSync(
		htmlPath,
		`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${initMarkup}
${cssTag}
</head>
<body>
<div id="root"></div>
<script type="module" src="${WANIWANI_WIDGET_BASE_URL_PLACEHOLDER}${assetBase}.js"></script>
</body>
</html>
`,
	);
}

function resolveGlobalCss(
	projectRoot: string,
	globalCss: string | false | undefined,
): string | null {
	if (globalCss === false) {
		return null;
	}
	const candidate = resolveProjectPath(
		projectRoot,
		globalCss ?? "app/globals.css",
	);
	return existsSync(candidate) ? candidate : null;
}

function toStableHtmlPath(id: string, htmlPath: string): string {
	if (isStableWidgetHtmlPath(htmlPath)) {
		return htmlPath;
	}

	const routePath = normalizeRoutePath(htmlPath);
	const slug = routePath === "/" ? id : routePath.slice(1);
	return `/widgets/${slug}.html`;
}

function isStableWidgetHtmlPath(htmlPath: string): boolean {
	return (
		htmlPath.startsWith("/widgets/") &&
		htmlPath.endsWith(".html") &&
		!htmlPath.includes("..")
	);
}

function normalizeRoutePath(htmlPath: string): string {
	const withoutQuery = htmlPath.split(/[?#]/)[0] || "/";
	const withoutTrailingSlash =
		withoutQuery.length > 1 ? withoutQuery.replace(/\/+$/, "") : withoutQuery;
	return withoutTrailingSlash.startsWith("/")
		? withoutTrailingSlash
		: `/${withoutTrailingSlash}`;
}

function stripWidgetsPrefix(assetBase: string): string {
	return assetBase.replace(/^\/widgets\//, "");
}

function safeFileName(value: string): string {
	return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function importPath(fromDir: string, targetPath: string): string {
	const path = relative(fromDir, targetPath).replaceAll("\\", "/");
	return path.startsWith(".") ? path : `./${path}`;
}

function resolveProjectPath(projectRoot: string, path: string): string {
	return path.startsWith("/") ? path : resolve(projectRoot, path);
}

function isRouteGroup(segment: string): boolean {
	return segment.startsWith("(") && segment.endsWith(")");
}

if (process.argv[2] === BUILD_ARG) {
	const payload = process.argv[3];
	if (!payload) {
		console.error("WaniWani widgets: missing build payload.");
		process.exit(1);
	}

	const options = JSON.parse(
		Buffer.from(payload, "base64").toString("utf8"),
	) as WithWaniwaniWidgetsOptions;

	buildWaniwaniWidgets(options).catch((error) => {
		console.error(error);
		process.exit(1);
	});
}
