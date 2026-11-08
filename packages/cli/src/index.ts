#!/usr/bin/env node
/**
 * The `waniwani` CLI, for any MCP server.
 *
 *   waniwani login    log in to the Waniwani platform
 *   waniwani logout   forget the session
 *   waniwani switch   pick the organization the CLI acts in
 *   waniwani connect  link the folder to an agent, in waniwani.json
 *   waniwani dev      run the folder's dev script behind the agent's tunnel
 *
 * In a `@waniwani/kit` app, `dev` and the kit's own commands (`init`, `check`,
 * `build`, `start`, `eject`) run through the kit the app installed. See
 * ./kit.ts for why both packages answer every command.
 */

import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import dotenv from "dotenv";
import { parseArgs } from "./args.js";
import { PlatformError } from "./client.js";
import { PLATFORM_COMMANDS, runPlatform } from "./commands.js";
import { isKitApp, KIT_COMMANDS, runKit } from "./kit.js";
import { banner, dim, red } from "./ui.js";

const { version } = createRequire(import.meta.url)("../package.json") as { version: string };

async function main(): Promise<number> {
	const argv = process.argv.slice(2);
	const [command = "dev", ...rest] = argv;

	if (command === "--version" || command === "-v") {
		console.log(version);
		return 0;
	}

	const { positional } = parseArgs(rest);
	const root = resolve(command === "switch" || command === "init" ? "." : (positional[0] ?? "."));

	if (KIT_COMMANDS.has(command) || (command === "dev" && isKitApp(root))) {
		return runKit(root, argv.length > 0 ? argv : ["dev"]);
	}

	if (PLATFORM_COMMANDS.has(command) || command === "dev") {
		if (command === "login" || command === "dev") banner(version);
		// `.env.local` first: the first file to set a variable wins, and a variable
		// already in the environment wins over both.
		dotenv.config({ path: [join(root, ".env.local"), join(root, ".env")], quiet: true });
		return runPlatform(argv.length > 0 ? argv : ["dev"]);
	}

	console.error(red(`unknown command: ${command}`));
	console.error(dim("usage: waniwani <login|logout|connect|dev> [dir]"));
	console.error(dim("       waniwani switch [org]"));
	console.error(dim("       waniwani <init|check|build|start|eject> [dir]   (from @waniwani/kit)"));
	return 1;
}

try {
	process.exit(await main());
} catch (error) {
	console.error(`\n${red("✗")} ${error instanceof Error ? error.message : String(error)}`);
	if (process.env.WANIWANI_DEBUG) {
		console.error(error);
	} else if (!(error instanceof PlatformError)) {
		console.error(dim("set WANIWANI_DEBUG=1 for the stack trace"));
	}
	process.exit(1);
}
