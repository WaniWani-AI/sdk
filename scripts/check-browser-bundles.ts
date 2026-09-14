/**
 * `platform: "browser"` keeps bare `crypto`/`url`/`process` out of these entries
 * and opts some packages into DOM-only builds that run `document` at import.
 * Both leave the build green and break a consumer instead: the second one broke
 * app.waniwani.ai, which prerenders `chat` on the server.
 */
import { spawnSync } from "node:child_process";
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
				const carrier = file.slice(dist.length + 1);
				failures.push(
					`${entry} imports the Node builtin "${spec}"${carrier === entry ? "" : `, reached through ${carrier}`}`,
				);
			}
		}
	}
}

// node, not bun: `--enable-source-maps` turns the frame inside the bundle back
// into the dependency that ran the DOM code, and prints the line itself.
for (const entry of ENTRIES) {
	const probe = spawnSync(
		"node",
		["--enable-source-maps", "-e", `import(${JSON.stringify(resolve(dist, entry))})`],
		{ encoding: "utf8" },
	);
	if (probe.error) {
		throw probe.error;
	}
	if (probe.status !== 0) {
		const reported = probe.stderr.trim().split("\n").slice(0, 8).join("\n    ");
		failures.push(`${entry} does not import without a DOM:\n    ${reported}`);
	}
}

if (failures.length > 0) {
	console.error("Browser bundle check failed:\n");
	for (const failure of new Set(failures)) {
		console.error(`  ${failure}\n`);
	}
	console.error(
		"A dependency resolved to its Node or DOM-only build. Alias it to the isomorphic\n" +
			"entry in tsup.config.ts, the way decode-named-character-reference is, or drop the\n" +
			"dependency. Reverting `platform: \"browser\"` is not the fix: that is what keeps the\n" +
			"bare crypto/url/process imports out in the first place.",
	);
	process.exit(1);
}

console.log(`Browser bundles OK (${ENTRIES.join(", ")})`);
