/**
 * `platform: "browser"` keeps bare `crypto`/`url`/`process` out of these entries
 * and opts some packages into DOM-only builds that run `document` at import.
 * Both leave the build green and break a consumer instead: the second one broke
 * app.waniwani.ai, which prerenders `chat` on the server.
 */
import { existsSync, readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, resolve } from "node:path";

const dist = resolve(import.meta.dirname, "../dist");

// `mcp/react/skybridge` is left out: `skybridge` is an optional peer and is not
// installed, so importing it here fails on the external, not on the bundle.
const ENTRIES = ["chat/index.js", "mcp/react.js"];

const builtins = new Set([
	...builtinModules,
	...builtinModules.map((m) => `node:${m}`),
]);

function reachable(entry: string): string[] {
	const seen = new Set<string>();
	const queue = [entry];
	for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
		// The specifier regex also matches ordinary string literals that look
		// like a path, so only real files go on the queue.
		if (seen.has(file) || !existsSync(file)) {
			continue;
		}
		seen.add(file);
		const source = readFileSync(file, "utf8");
		for (const [, spec] of source.matchAll(/["'](\.\.?\/[^"']+\.js)["']/g)) {
			queue.push(resolve(dirname(file), spec));
		}
	}
	return [...seen];
}

const failures: string[] = [];

for (const entry of ENTRIES) {
	for (const file of reachable(resolve(dist, entry))) {
		const source = readFileSync(file, "utf8");
		for (const [, spec] of source.matchAll(
			/(?:from|import)\s*["']([^"'.][^"']*)["']/g,
		)) {
			if (builtins.has(spec)) {
				failures.push(
					`${entry}: imports the Node builtin "${spec}" (via ${file.slice(dist.length + 1)})`,
				);
			}
		}
	}
}

// Bun's runtime has no DOM, which is the environment an SSR render provides.
for (const entry of ENTRIES) {
	try {
		await import(resolve(dist, entry));
	} catch (error) {
		failures.push(
			`${entry}: fails to import without a DOM — ${(error as Error).message.split("\n")[0]}`,
		);
	}
}

if (failures.length > 0) {
	console.error("Browser bundle check failed:");
	for (const failure of failures) {
		console.error(`  - ${failure}`);
	}
	process.exit(1);
}

console.log(`Browser bundles OK (${ENTRIES.join(", ")})`);
