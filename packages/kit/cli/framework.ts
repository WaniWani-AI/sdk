/**
 * The framework boundary.
 *
 * The generated project is built on a third-party MCP framework, and that
 * framework's CLI narrates itself: a branded banner on `dev`, `build` and
 * `start`, pointers at its own hosted tunnel and playground, a support link, and
 * an analytics event per command. An app author is using `waniwani`, so none of
 * that is output to hand them. Every place the framework speaks is intercepted
 * here rather than scattered across the commands.
 *
 * Three seams do the work:
 *
 *   dev     `--plain` drops the interactive UI and writes each diagnostic to
 *           stderr as one plain line, which makes the stream rewritable.
 *   build   the step list behind the interactive UI is plain data, so this CLI
 *           loads it, drives the steps, and prints the progress itself.
 *   start   the banner is ordinary `console.log`, so stdout is rewritten the
 *           same way as dev's stderr.
 *
 * What no amount of output rewriting reaches: the devtools page served at the
 * dev server's root is the framework's own UI, and the generated project names
 * the framework in its `tsconfig`, its dependencies, and its type-output
 * directory. Nothing here is concealment — the dependency is declared in
 * `package.json` like any other. It is a house style: one CLI does the talking.
 *
 * Module specifiers, the dependency name, the telemetry variable and the
 * patterns that have to match the framework's own strings are load-bearing and
 * stay as they are. Prose does not.
 */

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { bold, dim, endpoint, green, red, yellow } from "./log.js";
import type { BuildStep, LineFilter } from "./types.js";
import { missingOptionalPeers } from "./vercel.js";

/**
 * A rule for rewriting one line of the framework's output: the pattern to test
 * the de-coloured line against, and what to print in its place. `null` drops it.
 */
type Rule = [RegExp, (match: RegExpExecArray) => string | null];

/**
 * The framework package root. It may be hoisted anywhere above us, so resolve
 * it rather than guess: its `tsconfig` export is the only one that maps to a
 * file at the package root, which makes it a reliable anchor for the directory.
 */
export function frameworkDir(): string {
	return dirname(fileURLToPath(import.meta.resolve("skybridge/tsconfig")));
}

export function frameworkBin(): string {
	return join(frameworkDir(), "bin", "run.js");
}

/**
 * Environment applied to every framework subprocess.
 *
 * The framework's CLI reports each command to a third-party analytics endpoint,
 * keyed by a machine id it persists in the user's home directory. Running
 * someone's build is not consent to that, so it is off by both switches the
 * framework honours.
 */
export const FRAMEWORK_ENV: Record<string, string> = {
	SKYBRIDGE_TELEMETRY_DISABLED: "1",
	DO_NOT_TRACK: "1",
};

/**
 * Match against the text, not the colours the framework wrapped it in.
 *
 * ESC is built from its char code rather than written as a raw byte or an
 * escape sequence. The byte is invisible in source and survives no copy or
 * reformat reliably; an escape sequence gets normalised back into the byte by
 * some tooling. Either way the loss is silent, and every rule below then fails
 * to match any coloured line.
 */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

/**
 * A framework command name leaking through an otherwise fine line — an error
 * hint, a nodemon echo. The commands map one to one, so the name is swapped for
 * ours rather than the line dropped.
 */
function reword(line: string): string {
	return line.replace(/\bskybridge (build|dev|start)\b/g, "waniwani $1");
}

/**
 * How each line of `dev --plain` diagnostics is rewritten.
 *
 * The framework's stderr is a closed set: a banner, three or four URLs, the
 * tunnel's state, restart notices, and TypeScript errors. The app's own stderr
 * comes through the same pipe, so an unmatched line is passed through — except
 * under the emoji prefixes the framework owns, which are dropped rather than
 * guessed at, since a `starting` tunnel message is verbatim output from a
 * subprocess of its own and can say anything.
 *
 * The framework's own tunnel is one of those lines. No command here asks for it,
 * so what arrives is its offer of one, and the emoji it carries drops the line.
 *
 * Each pattern leads with `\W*` to absorb whatever emoji prefixes the line and
 * ends at `$`, so a rule reads the framework's whole line and can't fire on an
 * app log that happens to open with the same words.
 */
const BANNER_AND_URLS: Rule[] = [
	// Matched by shape — `<name> v1.2.3` alone on a line — which costs nothing in
	// precision and keeps the framework's name out of this file.
	[/^\W*\S+ v\d+\.\d+\.\d+\S*$/u, () => null],
	[
		/^\W*(\d+) in use, running on (\S+)$/u,
		(m) => `${endpoint("server", m[2])} ${dim(`(${m[1]} in use)`)}`,
	],
	[/^\W*Running on (\S+)$/u, (m) => endpoint("server", m[1])],
];

const DEV_RULES: Rule[] = [
	...BANNER_AND_URLS,
	// The devtools page is the framework's own UI and nobody here reaches for it,
	// so its URL is dropped rather than restated.
	[/^\W*Test locally with DevTools: \S+$/u, () => null],
	[
		/^\W*Server restarted due to file changes: (.*)$/u,
		(m) => dim(`[waniwani] restarted — ${m[1]}`),
	],
	[/^\W*TypeScript errors found:\W*$/u, () => `${yellow("!")} ${bold("TypeScript errors")}`],
];

/** `start` prints its banner to stdout without ever mounting the UI. */
const START_RULES: Rule[] = BANNER_AND_URLS;

/** Emoji the framework prefixes its own chrome with. */
const FRAMEWORK_PREFIX = /^(?:⛰|🏠|🌍|🛟|→)/u;

function rewriter(
	rules: Rule[],
	{ dropUnmatchedChrome }: { dropUnmatchedChrome: boolean },
): (line: string) => string | null {
	return (line) => {
		const text = line.replace(ANSI, "").trimEnd();
		for (const [pattern, format] of rules) {
			const match = pattern.exec(text);
			if (match) return format(match);
		}
		if (dropUnmatchedChrome && FRAMEWORK_PREFIX.test(text)) return null;
		return reword(line);
	};
}

/**
 * Feed a subprocess stream through `rewrite` one whole line at a time, writing
 * the result to `out`. A rewrite of `null` drops the line.
 *
 * Chunk boundaries fall anywhere, so a partial line is held until its newline
 * arrives; `flush` emits whatever is left when the stream closes.
 */
function lineFilter(
	rewrite: (line: string) => string | null,
	out: NodeJS.WritableStream,
): LineFilter {
	let buffered = "";
	const emit = (line: string) => {
		const rewritten = rewrite(line);
		if (rewritten !== null) {
			out.write(`${rewritten}\n`);
		}
	};
	return {
		write(chunk: string) {
			buffered += chunk;
			const lines = buffered.split("\n");
			buffered = lines.pop() ?? "";
			for (const line of lines) emit(line);
		},
		flush() {
			if (buffered) {
				const line = buffered;
				buffered = "";
				emit(line);
			}
		},
	};
}

/** Diagnostics stay on stderr, so the app's own stdout is never in the way. */
export function devFilter(): LineFilter {
	return lineFilter(rewriter(DEV_RULES, { dropUnmatchedChrome: true }), process.stderr);
}

export function startFilter(): LineFilter {
	return lineFilter(rewriter(START_RULES, { dropUnmatchedChrome: false }), process.stdout);
}

/**
 * The framework's build as a list of labelled steps, or null if it can't be
 * reached in that form.
 *
 * The step list sits outside the package's `exports` map, so it is reachable
 * only by absolute path — the same coupling this CLI already accepts for the
 * framework's `bin`, against a version codegen pins exactly. When the module or
 * its shape has moved, null tells the caller to shell out to the framework's own
 * build command instead: a build that narrates itself beats no build at all.
 */
export async function loadBuildSteps(root: string): Promise<BuildStep[] | null> {
	const path = join(frameworkDir(), "dist", "cli", "build-steps.js");
	if (!existsSync(path)) return null;

	let getCommandSteps: unknown;
	try {
		({ getCommandSteps } = (await import(pathToFileURL(path).href)) as {
			getCommandSteps?: unknown;
		});
	} catch {
		return null;
	}
	if (typeof getCommandSteps !== "function") return null;

	// A throw from here on is a real build failure — a broken vite config, two
	// views with one name — and belongs to the caller, not to the fallback.
	const steps: unknown = await (getCommandSteps as (root: string) => unknown)(root);
	const usable =
		Array.isArray(steps) &&
		steps.length > 0 &&
		steps.every(
			(step: unknown): step is BuildStep =>
				typeof step === "object" &&
				step !== null &&
				typeof (step as BuildStep).label === "string" &&
				(typeof (step as BuildStep).run === "function" ||
					typeof (step as BuildStep).command === "string"),
		);
	return usable ? await withServerExternals(steps as BuildStep[], root) : null;
}

/** The framework's label for the step that bundles the server into a Vercel function. */
const VERCEL_STEP = "Emitting Vercel build output";

/**
 * The step list with the Vercel bundle told to leave out the optional peers
 * nothing installed. See `missingOptionalPeers` in `./vercel.js` for why.
 *
 * The framework takes extra externals from one place, the `serverExternal`
 * option of its vite plugin, and the vite config is the template's file. So the
 * step is run here instead: the same two framework functions it calls, read by
 * absolute path like the step list itself, with the plugin's list kept and the
 * missing peers added to it. When either function has moved, the framework's
 * step runs as it is.
 */
async function withServerExternals(steps: BuildStep[], root: string): Promise<BuildStep[]> {
	const step = steps.find((candidate) => candidate.label === VERCEL_STEP && candidate.run);
	if (!step) return steps;

	const cli = join(frameworkDir(), "dist", "cli");
	let emitVercelBuildOutput: unknown;
	let resolveSkybridgeConfig: unknown;
	try {
		({ emitVercelBuildOutput } = (await import(
			pathToFileURL(join(cli, "build-helpers.js")).href
		)) as { emitVercelBuildOutput?: unknown });
		({ resolveSkybridgeConfig } = (await import(
			pathToFileURL(join(cli, "resolve-skybridge-config.js")).href
		)) as { resolveSkybridgeConfig?: unknown });
	} catch {
		return steps;
	}
	if (typeof emitVercelBuildOutput !== "function" || typeof resolveSkybridgeConfig !== "function") {
		return steps;
	}

	step.run = async () => {
		const config = (await resolveSkybridgeConfig(root)) as { serverExternal?: string[] };
		const external = [
			...new Set([...(config.serverExternal ?? []), ...missingOptionalPeers(root)]),
		];
		await emitVercelBuildOutput(root, external);
	};
	return steps;
}

/**
 * Run the loaded steps, one printed line each. `runShell` is injected so the
 * caller keeps ownership of how subprocesses are spawned — PATH, environment,
 * which stream they inherit.
 */
export async function runBuildSteps(
	steps: BuildStep[],
	{ root, runShell }: { root: string; runShell: (command: string) => Promise<number> },
): Promise<number> {
	// The steps read and write relative to the working directory, which is the
	// generated project when the framework runs them itself.
	const previousCwd = process.cwd();
	process.chdir(root);
	try {
		for (const step of steps) {
			try {
				if (step.run) {
					await step.run();
				}
				if (step.command) {
					const code = await runShell(step.command);
					if (code !== 0) {
						console.error(`  ${red("✗")} ${step.label}`);
						return code;
					}
				}
			} catch (error) {
				console.error(`  ${red("✗")} ${step.label}`);
				throw error;
			}
			console.log(`  ${green("✓")} ${dim(step.label)}`);
		}
		return 0;
	} finally {
		process.chdir(previousCwd);
	}
}
