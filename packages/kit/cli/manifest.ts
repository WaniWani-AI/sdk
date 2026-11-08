/**
 * This package's own `package.json`, read once.
 *
 * Four modules needed it and each computed the path itself, as
 * `join(dirname(fileURLToPath(import.meta.url)), "..")`. That traversal was
 * correct only while the CLI ran from `cli/` next to the manifest, and the
 * compiled output lands in `dist/cli/` one level deeper — so the same four
 * lines would have had to disagree between a source run and an installed one.
 *
 * Walking up for the manifest that names this package answers from either
 * depth, and from anywhere else a bundler or a symlink might put the file. It
 * depends on nothing but the directory tree.
 *
 * Reading this at import time is deliberate: every version the generator forces
 * on an app comes out of here (see `declared()` in `./codegen.ts`), so a
 * manifest that cannot be found should stop the CLI before it writes anything,
 * not halfway through generating a project.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PackageManifest } from "./types.js";

const PACKAGE_NAME = "@waniwani/kit";

function findPackageRoot(from: string): string {
	let current = from;
	while (true) {
		const candidate = join(current, "package.json");
		if (existsSync(candidate)) {
			try {
				const parsed = JSON.parse(readFileSync(candidate, "utf-8")) as PackageManifest;
				if (parsed.name === PACKAGE_NAME) return current;
			} catch {
				// A package.json that does not parse belongs to somebody else's
				// directory on the way up. Keep walking.
			}
		}
		const parent = dirname(current);
		if (parent === current) {
			throw new Error(
				`cannot find the ${PACKAGE_NAME} package root above ${from} — ` +
					"this CLI reads its own manifest for every version it pins",
			);
		}
		current = parent;
	}
}

/** The directory holding this package's manifest, `src/` and `dist/`. */
export const PACKAGE_ROOT = findPackageRoot(dirname(fileURLToPath(import.meta.url)));

/** This package's manifest, which is where every version the generator pins comes from. */
export const MANIFEST = JSON.parse(
	readFileSync(join(PACKAGE_ROOT, "package.json"), "utf-8"),
) as PackageManifest;

export const PACKAGE_VERSION = MANIFEST.version ?? "0.0.0";

/**
 * The runtime's source, shipped so `waniwani eject` has readable source to
 * vendor. Nothing resolves through it: Node refuses to strip types under
 * `node_modules/`, which is why `dist/` exists.
 */
export const RUNTIME_SRC = join(PACKAGE_ROOT, "src");
