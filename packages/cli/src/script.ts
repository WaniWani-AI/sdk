/**
 * A folder that is not a kit app but has a `dev` script: a hand-written MCP
 * server, or a managed agent's repo. `waniwani dev` runs that script under the
 * repo's own package manager, with the port in `PORT`, and links it to the
 * platform. Everything about the server is the repo's own business.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const LOCKFILES: [string, string][] = [
	["bun.lock", "bun"],
	["bun.lockb", "bun"],
	["pnpm-lock.yaml", "pnpm"],
	["yarn.lock", "yarn"],
];

/**
 * Set on the script `dev` runs. A script that reaches `waniwani dev` again
 * (through another script, say) finds it and stops there instead of starting a
 * second copy of itself.
 */
export const NESTED_DEV = "WANIWANI_DEV_SCRIPT";

/**
 * `[command, args]` for the folder's `dev` script, or null when it has none.
 *
 * A script that calls `waniwani` is not one to run: in a kit app whose config
 * file is missing, `"dev": "waniwani dev"` would run this command again.
 */
export function devScript(root: string): [string, string[]] | null {
	const manifest = join(root, "package.json");
	if (!existsSync(manifest)) return null;
	try {
		const { scripts } = JSON.parse(readFileSync(manifest, "utf8")) as {
			scripts?: Record<string, string>;
		};
		if (!scripts?.dev || /(^|[\s;&|/])waniwani(\s|$)/.test(scripts.dev)) return null;
	} catch {
		return null;
	}
	const manager = LOCKFILES.find(([file]) => existsSync(join(root, file)))?.[1] ?? "npm";
	return [manager, ["run", "dev"]];
}
