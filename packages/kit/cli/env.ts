/**
 * The app's `.env`, loaded into this CLI's own environment.
 *
 * Two problems make this the only place it can happen.
 *
 * The framework runs from the generated project, so `process.cwd()` is
 * `.waniwani/` and a bare `dotenv/config` looks for `.waniwani/.env` — a file
 * nobody wrote. The app's `.env` sits one level up, next to `waniwani.config.ts`.
 *
 * Loading it from generated code inside that project is too late anyway. ESM
 * evaluates a module's imports before its body, so by the time any line of
 * `src/waniwani.ts` runs, every app module it imports has already been
 * evaluated — and a module that builds an API client at import time has already
 * read the empty environment and captured it. `createFlow(...).compile()` is the
 * loud version of this: it throws at import time when `WANIWANI_API_KEY` is
 * absent.
 *
 * Loading here, before anything is spawned, puts the variables in the
 * environment every child process inherits, whatever order its modules load in.
 * Hosted deploys set their variables on the platform and never reach this path.
 */

import { join } from "node:path";
import dotenv from "dotenv";

const loaded = new Set<string>();

/**
 * `.env.local` before `.env`: the first file to define a variable wins, and
 * dotenv never overwrites one already in the environment, so a value exported in
 * the shell or set by CI outranks both files.
 */
export function loadAppEnv(root: string): void {
	if (loaded.has(root)) return;
	loaded.add(root);
	dotenv.config({ path: [join(root, ".env.local"), join(root, ".env")], quiet: true });
}
