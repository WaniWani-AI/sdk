/**
 * The Vercel boundary.
 *
 * Vercel adopts a build's output when it finds a Build Output API tree at
 * `.vercel/output` in the project's root directory, and nowhere else. The
 * framework emits that tree inside the generated project, which is gitignored
 * and absent from a clone, so the last thing a build does is move it up to the
 * app root — the one path Vercel reads.
 *
 * That move is what removes the need for a `vercel.json` in an app repo. With
 * the tree where Vercel looks for it, a git-connected project needs no deploy
 * config at all: the `Other` preset runs the `build` script from `package.json`,
 * which is `waniwani build`, and the output is adopted as built. Every decision
 * a deploy config would carry is taken here instead, once, for every app on
 * this kit.
 */

import {
	cpSync,
	existsSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

/** One entry of the Build Output API's routing table. */
interface OutputRoute {
	src?: string;
	dest?: string;
	handle?: string;
}

interface OutputConfig {
	routes?: OutputRoute[];
}

/** Where the framework writes its tree, and where Vercel reads one. */
const OUTPUT = join(".vercel", "output");

/**
 * Every request under `/api` reaches the server this kit built.
 *
 * Vercel reserves a root `api/` directory and compiles every file under one
 * into a serverless function of its own, which for an app folder means one
 * broken function per endpoint — `defineEndpoint({ ... })` is an object, not a
 * Vercel handler — sitting in the filesystem layer ahead of the server that
 * actually serves them. The reservation cannot be waived: the file list is read
 * before the build command runs, so a build that deletes the directory fails
 * with `File not found`, and `outputDirectory` does not suppress the builder.
 *
 * What it can be beaten by is precedence. This route goes in ahead of the
 * `filesystem` handler, which is where those functions sit, so `/api/*` never
 * reaches them.
 *
 * `/.well-known/*` gets no companion route, and needs none. Vercel reserves
 * nothing under it, the build writes no static file there, so the filesystem
 * phase misses and the catch-all below it — the one the framework already emits
 * — carries the request to the same function. A route here would say what is
 * already true.
 */
const API_ROUTE = "/api(/.*)?";

/**
 * Move the framework's Build Output tree from the generated project up to the
 * app root, and route `/api/*` at the server on the way.
 *
 * @returns the directory Vercel will read, or null when the build emitted no tree
 */
export function stageBuildOutput(generatedDir: string, appRoot: string): string | null {
	const from = join(generatedDir, OUTPUT);
	if (!existsSync(from)) return null;

	const to = join(appRoot, OUTPUT);
	if (from !== to) {
		// `.vercel/` also holds the CLI's project link, so only the output half is
		// cleared. Rename over a copy: same filesystem, and it leaves nothing
		// behind to fall out of date.
		rmSync(to, { recursive: true, force: true });
		mkdirSync(dirname(to), { recursive: true });
		try {
			renameSync(from, to);
		} catch {
			cpSync(from, to, { recursive: true });
			rmSync(from, { recursive: true, force: true });
		}
		// The framework recreates its own `.vercel/` on every build, so what the
		// move leaves behind is an empty directory that means nothing.
		rmSync(dirname(from), { recursive: true, force: true });
	}

	routeApiAtTheServer(to);
	return to;
}

/**
 * Insert the `/api` route ahead of the filesystem handler in the tree's own
 * routing table.
 *
 * The destination is read from the config rather than named here: the framework
 * decides what its function is called, and a route pointing at a name it has
 * since changed would black-hole every request.
 */
function routeApiAtTheServer(outputDir: string): void {
	const file = join(outputDir, "config.json");
	if (!existsSync(file)) return;

	let config: OutputConfig;
	try {
		config = JSON.parse(readFileSync(file, "utf-8")) as OutputConfig;
	} catch {
		return;
	}
	const routes = config.routes;
	if (!Array.isArray(routes)) return;
	if (routes.some((route) => route.src === API_ROUTE)) return;

	const filesystem = routes.findIndex((route) => route.handle === "filesystem");
	if (filesystem === -1) return;

	// The catch-all below the filesystem handler is the server. Anything under
	// `/api` that the app did not build is already going there.
	const server = routes.slice(filesystem).find((route) => route.dest && !route.handle);
	if (!server?.dest) return;

	routes.splice(filesystem, 0, { src: API_ROUTE, dest: server.dest });
	writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
}

/** The parts of a package manifest the walk below reads. */
interface PackageManifest {
	dependencies?: Record<string, string>;
	optionalDependencies?: Record<string, string>;
	peerDependencies?: Record<string, string>;
	peerDependenciesMeta?: Record<string, { optional?: boolean }>;
}

/**
 * The directory of package `name` as Node would find it from `fromDir`: the
 * first `node_modules/<name>` on the way up. Resolved through symlinks, because
 * an isolated install links every package in from a store, and the store path
 * is where that package's own dependencies are found.
 */
function locatePackage(name: string, fromDir: string): string | null {
	for (let dir = fromDir; ; dir = dirname(dir)) {
		const candidate = join(dir, "node_modules", name);
		if (existsSync(join(candidate, "package.json"))) return realpathSync(candidate);
		if (dirname(dir) === dir) return null;
	}
}

function readManifest(dir: string): PackageManifest | null {
	try {
		return JSON.parse(readFileSync(join(dir, "package.json"), "utf-8")) as PackageManifest;
	} catch {
		return null;
	}
}

/**
 * Optional peer dependencies of the server's dependency tree that nothing
 * installed, for the Vercel function bundle to leave external.
 *
 * The function is one file bundled by esbuild, and esbuild fails the build on
 * any import it cannot resolve, a dynamic `import()` included. A package that
 * marks a peer optional in `peerDependenciesMeta` states that it runs without
 * it, typically through an import inside a `try` that falls back when the
 * module is absent. posthog-node, which the framework depends on, reaches for
 * `@opentelemetry/api` that way. Left external, that import fails at run time,
 * which is the case the package handles, and the same as Node running the tree
 * unbundled. Bundled, it fails the build of every app whose tree does not hold
 * the peer.
 *
 * An external is a name, so it applies to every importer in the bundle, and an
 * external module is absent from the deployed function. A peer that any
 * package in the tree can find is therefore kept off the list, and esbuild
 * bundles it as usual for the app that installed it.
 *
 * The walk starts at the `dependencies` of `root` and follows `dependencies`,
 * `optionalDependencies` and peers into every package it finds.
 */
export function missingOptionalPeers(root: string): string[] {
	const located = new Set<string>();
	const optional = new Set<string>();
	const seen = new Set<string>();
	const queue: [dir: string, manifest: PackageManifest][] = [];

	const start = readManifest(root);
	if (!start) return [];
	queue.push([root, { dependencies: start.dependencies }]);

	for (let next = queue.shift(); next; next = queue.shift()) {
		const [dir, manifest] = next;
		const names = [
			...Object.keys(manifest.dependencies ?? {}),
			...Object.keys(manifest.optionalDependencies ?? {}),
			...Object.keys(manifest.peerDependencies ?? {}),
			...Object.keys(manifest.peerDependenciesMeta ?? {}),
		];
		for (const name of new Set(names)) {
			const found = locatePackage(name, dir);
			if (!found) {
				if (manifest.peerDependenciesMeta?.[name]?.optional) optional.add(name);
				continue;
			}
			located.add(name);
			if (seen.has(found)) continue;
			seen.add(found);
			const child = readManifest(found);
			if (child) queue.push([found, child]);
		}
	}

	return [...optional].filter((name) => !located.has(name)).sort();
}
