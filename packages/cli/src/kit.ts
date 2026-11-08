/**
 * Handing a command to `@waniwani/kit`.
 *
 * Both packages install a `waniwani` binary, and only one of them gets linked
 * when both are installed. So each one answers the other's commands: the kit
 * imports this package and calls `runPlatform`, and this package runs the kit
 * that the app itself installed. Whichever binary a shell finds, the command
 * does the same thing.
 *
 * The kit is resolved from the app folder, never from this package, so an app
 * runs the kit version its own lockfile pins.
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { PlatformError } from "./client.js";

/** The commands only the kit has. `dev` goes to the kit too, in a kit app. */
export const KIT_COMMANDS: ReadonlySet<string> = new Set([
	"init",
	"check",
	"build",
	"start",
	"eject",
]);

/** A kit app is a folder with a `waniwani.config.ts`. */
export function isKitApp(root: string): boolean {
	return ["waniwani.config.ts", "waniwani.config.js"].some((file) => existsSync(join(root, file)));
}

/**
 * The kit's binary, from the nearest `node_modules/@waniwani/kit` at or above
 * `root`. Read from its `package.json` rather than resolved through `exports`,
 * which does not expose the manifest.
 */
export function findKitBin(root: string): string | null {
	let dir = resolve(root);
	while (true) {
		const manifest = join(dir, "node_modules", "@waniwani", "kit", "package.json");
		if (existsSync(manifest)) {
			try {
				const { bin } = JSON.parse(readFileSync(manifest, "utf8")) as {
					bin?: string | Record<string, string>;
				};
				const entry = typeof bin === "string" ? bin : bin?.waniwani;
				if (entry) return join(dirname(manifest), entry);
			} catch {
				// An unreadable manifest is the same as no kit.
			}
		}
		const parent = dirname(dir);
		if (parent === dir) return null;
		dir = parent;
	}
}

/** Run a child with this terminal, leaving Ctrl-C to it, and return its exit code. */
function inherit(command: string, args: string[]): Promise<number> {
	return new Promise((resolveExit) => {
		const child = spawn(command, args, {
			stdio: "inherit",
			shell: process.platform === "win32" && command !== process.execPath,
		});
		// The child reads Ctrl-C from the same terminal and exits on it; this
		// process waits for that exit to report its code.
		const ignore = () => {};
		process.on("SIGINT", ignore);
		child.on("close", (code) => {
			process.off("SIGINT", ignore);
			resolveExit(code ?? 1);
		});
		child.on("error", (error) => {
			console.error(`failed to run ${command}: ${error.message}`);
			resolveExit(1);
		});
	});
}

/**
 * Run a kit command through the app's own kit. `init` has no app yet, so it
 * runs the latest kit from the registry instead.
 */
export function runKit(root: string, argv: string[]): Promise<number> {
	const bin = findKitBin(root);
	if (bin) return inherit(process.execPath, [bin, ...argv]);
	if (argv[0] === "init") {
		return inherit("npx", ["--yes", "@waniwani/kit@latest", ...argv]);
	}
	throw new PlatformError(
		`\`waniwani ${argv[0]}\` comes from @waniwani/kit, which this folder does not install — run \`npm install -D @waniwani/kit\``,
	);
}
