/**
 * `waniwani init`, the first command anyone runs.
 *
 * What it writes is an app folder that already passes `waniwani check` and
 * already renders something: a config, a tool, and the widget that displays what
 * the tool returned. The point of scaffolding a working pair instead of an empty
 * folder is that the tool-to-widget hand-off is the one piece of this framework
 * nobody guesses correctly from the type signatures.
 *
 *   waniwani init my-app          create my-app/ and scaffold in it
 *   waniwani init .               scaffold in the current directory
 *   waniwani init                 ask for a name, and put the app where the
 *                                 answer says: a name of its own creates
 *                                 ./<name>/, the offered default (the current
 *                                 folder's name) scaffolds in place
 *
 * In a terminal it asks three questions — the name, whether the widget comes
 * with the tool, and where the app deploys — and every flag below answers one of
 * them ahead of time, so a question is asked only where nothing has answered it.
 * Piped, on CI, or under `--yes`, nothing is asked and the defaults stand.
 *
 *   --name <name>    the MCP server name, default the directory name
 *   --host <host>    where it deploys: vercel, alpic, container, none
 *   --minimal        config and one tool, no widget
 *   --yes            take every default, ask nothing
 *   --no-install     skip the dependency install
 *   --force          overwrite app files that are already there
 *
 * What it copies lives in `templates/starter/`, as files rather than as strings
 * in this module, so the repo's own type-checker and formatter run over the
 * scaffold.
 *
 * Running it inside a repo that already has files is expected and supported.
 * A `package.json` is merged rather than replaced, a `.gitignore` gains the
 * lines it lacks, and a `README.md` or `.env.example` that exists is left
 * alone. Only the app's own source files count as a collision, and those stop
 * the command until `--force` says otherwise.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { bold, dim, green, yellow } from "./log.js";
import { PACKAGE_ROOT, PACKAGE_VERSION } from "./manifest.js";
import { installable, preferred } from "./peers.js";
import { askOne, askText, type Choice, canAsk, close, fail, open } from "./prompt.js";
import { latestVersion } from "./registry.js";
import type { Flags, PackageManifest } from "./types.js";

/** The name and title every scaffolded file is written against. */
interface ScaffoldApp {
	name: string;
	title: string;
}

/**
 * One file the scaffold writes.
 *
 * `whenPresent` decides what happens to one already on disk: absent is a
 * collision that stops the command, `"merge"` folds the scaffold's contribution
 * into what is there, and `"keep"` leaves it untouched.
 */
interface ScaffoldFile {
	path: string;
	contents: string;
	whenPresent?: "merge" | "keep";
	/** Returns the keys or lines added, for the CLI to report. */
	merge?: (file: string, contents: string) => string[];
}

/** The package managers this CLI recognises, in the order it prefers them. */
type PackageManagerName = "bun" | "pnpm" | "yarn" | "npm";

/**
 * The letters NFD leaves whole, because their Latin shape is not a base letter
 * with a mark on it. Without these, `Straße` reaches the ASCII filter as `stra`
 * and comes out `stra` — a name for a different product.
 */
const SPELLED_OUT: Record<string, string> = {
	ß: "ss",
	æ: "ae",
	œ: "oe",
	ø: "o",
	đ: "d",
	ð: "d",
	ł: "l",
	þ: "th",
};

/**
 * A directory name as an MCP server name: `My App` becomes `my-app`.
 *
 * NFD splits an accented letter into a base letter and a combining mark, so
 * dropping the marks turns `Café` into `cafe` rather than into `caf`, which is
 * what dropping the composed character would give. What survives is a name npm
 * and a filesystem both accept, and the answer as typed is kept as the title.
 */
function slugify(input: string): string {
	// Spelled out character by character rather than through a class of the same
	// letters, so the table above is the only place they are written down. A class
	// is where `đ` quietly becomes a `d` that maps to nothing.
	const spelled = [...input.trim().toLowerCase()]
		.map((letter) => SPELLED_OUT[letter] ?? letter)
		.join("");

	const slug = spelled
		.normalize("NFD")
		.replace(/\p{Diacritic}/gu, "")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return slug || "my-app";
}

/** `my-app` becomes `My app`, for the human-facing title. */
function titleize(slug: string): string {
	const words = slug.replace(/[-_]+/g, " ");
	return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * A title, made safe to drop into the generated TypeScript and Markdown.
 * Backticks, quotes, backslashes and `$` are the characters that would end a
 * string or a template literal early, and a product name needs none of them.
 */
function cleanTitle(input: string): string {
	return input
		.replace(/[`"'\\$]/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

/**
 * What a new app depends on.
 *
 * Every version is read off this package's own manifest: `@waniwani/kit` at the
 * version of the CLI doing the scaffolding, and the peers at the floors this
 * package declares, capped by `installable` so a floor does not install the
 * next major on the day it lands. A scaffold that wrote its own numbers here
 * would be the one file in the folder that can be wrong the day it is created.
 *
 * `@waniwani/sdk` is the exception, and `sdk` is where it comes from. The floor
 * this package declares is frozen at release, so reading the SDK version off it
 * scaffolds whatever was current when the kit shipped rather than what npm
 * serves — see `preferred` in `./peers.ts`, which is what the caller resolves
 * this through.
 *
 * It is written out at all, rather than left to arrive as a required peer,
 * because the app imports it directly — `flows/*.ts` calls `createFlow` — and a
 * package you import belongs in your own manifest.
 */
function dependencies(sdk: string): Record<string, string> {
	return {
		"@waniwani/kit": `^${PACKAGE_VERSION}`,
		"@waniwani/sdk": sdk,
		react: installable("react"),
		"react-dom": installable("react-dom"),
		zod: installable("zod"),
	};
}

// ------------------------------------------------------------ scaffold content

/**
 * The tool name and the widget name the scaffold uses. They are the filenames
 * under `templates/starter/`, and the filename is the name in this framework,
 * so renaming one here means renaming the file. `starter()` throws if the two
 * ever disagree.
 */
const TOOL = "search-products";
const WIDGET = "product-list";

/** Named once: it is looked up in the registry and written into the manifest. */
const SDK = "@waniwani/sdk";

/**
 * The starter app, on disk.
 *
 * Real files, the way create-next-app ships `templates/app/ts/` and create-vite
 * ships `template-react-ts/`: copied byte for byte, type-checked by
 * `tsconfig.templates.json` against the kit this workspace builds, and formatted
 * by the same biome config as the rest of the repo.
 *
 * The alternative is TypeScript inside a template literal in this module, which
 * costs it every check the repo runs: `tsc` cannot see the JSX, biome cannot
 * format it, and a change to `defineTool` or `useWidget` breaks the scaffold
 * with nothing going red until somebody runs `waniwani init` by hand. Escaping
 * is the visible half of that — a `\s` in the tool's regex has to be written
 * `\\s`, and every backtick and `${` in the widget carries a backslash that is
 * in no file anyone reads.
 *
 * Nothing here is interpolated, which is what makes that possible. The three
 * files that do carry the app's own name — `package.json`, `waniwani.config.ts`
 * and the README — are still written by this module, because they are data
 * rather than sample code. create-next-app draws the same line, and its
 * template folders carry no `package.json` at all.
 *
 * Two names differ on disk from what lands in the app. npm strips a `.gitignore`
 * out of a published tarball, so the file is `gitignore` here and both CLIs
 * above do the same (`gitignore` for Next, `_gitignore` for Vite); `.env.example`
 * follows it for consistency rather than necessity.
 */
const STARTER = join(PACKAGE_ROOT, "templates", "starter");

function starter(file: string): string {
	const source = join(STARTER, file);
	if (!existsSync(source)) {
		throw new Error(
			`the starter template is missing ${file} — looked in ${STARTER}. ` +
				"An installed copy carries it through the `templates` entry in this package's `files`.",
		);
	}
	return readFileSync(source, "utf-8");
}

function packageJson(app: ScaffoldApp, sdk: string): string {
	return `${JSON.stringify(
		{
			name: app.name,
			private: true,
			type: "module",
			scripts: {
				check: "waniwani check",
				dev: "waniwani dev",
				build: "waniwani build",
				start: "waniwani start",
			},
			dependencies: dependencies(sdk),
		},
		null,
		2,
	)}\n`;
}

function appConfig(app: ScaffoldApp): string {
	return `import { defineApp } from "@waniwani/kit";

export default defineApp({
	// The MCP server name. Hosts show \`title\` to humans and use this one as the id.
	name: ${JSON.stringify(app.name)},
	title: ${JSON.stringify(app.title)},
	// What the app is, and which tool to reach for when. How a single tool
	// behaves goes in that tool's own description instead.
	// overview: "...",
});
`;
}

function readme(app: ScaffoldApp): string {
	return `# ${app.title}

An MCP app built with [@waniwani/kit](https://www.npmjs.com/package/@waniwani/kit).
You own the folders below. The server, the transport, the bundling and the deploy
files are the kit's.

\`\`\`
waniwani.config.ts        the app's name and title, plus an optional overview
tools/*.ts                one file per tool; the filename is the tool name
widgets/<name>/           widget.ts for the contract, ui.tsx for the component
flows/*.ts                multi-step conversations, from @waniwani/sdk
\`\`\`

## Commands

\`\`\`bash
npm run dev        # dev server, regenerating on every change
npm run check      # validate the folder without building
npm run build      # production build
npm run start      # run the production build
\`\`\`

\`.waniwani/\` is build output, the way \`.next/\` is. Every command regenerates it
and it stays out of git.
`;
}

/**
 * The files a new app gets.
 *
 * `whenPresent` decides what happens to one that is already on disk:
 * `undefined` is a collision that stops the command, `merge` folds the
 * scaffold's contribution into what is there, and `keep` leaves it untouched.
 */
/** Where an app deploys, which decides the one config file the repo carries. */
export type HostId = "vercel" | "alpic" | "container" | "none";

interface Host {
	id: HostId;
	label: string;
	/** What the answer means, printed next to the option. */
	note: string;
	/** How to deploy, printed after the scaffold. */
	deploy: string[];
}

/**
 * The deploy targets `init` offers.
 *
 * Only Vercel needs a file in the app repo, and only for one reason: the
 * framework preset is a project setting that Vercel resolves before the build
 * command runs, so nothing the build emits can correct a project whose preset
 * says Next.js or Express. `framework: null` selects `Other`, which is the
 * preset that runs the `build` script and adopts the Build Output tree the kit
 * leaves at `.vercel/output`.
 *
 * Nothing else belongs in that file. A `buildCommand` would restate the `build`
 * script, and a `routes` table would duplicate the routing config the build
 * writes — both would then go stale against a kit that moved on. This one key is
 * a fact about the project rather than about the build, so it never changes.
 *
 * Alpic and a container image both read their config from the generated project,
 * which the build regenerates, so neither leaves anything tracked behind.
 */
const HOSTS: Host[] = [
	{
		id: "vercel",
		label: "Vercel",
		note: "git push, or `vercel deploy --prebuilt`",
		deploy: ["git push", "vercel deploy --prebuilt    # or upload a local build"],
	},
	{
		id: "container",
		label: "Docker",
		note: "Dockerfile comes from the build",
		deploy: ["waniwani build", "docker build .waniwani"],
	},
	{
		id: "alpic",
		label: "Alpic",
		note: "alpic.json comes from the build",
		deploy: ["waniwani build", "cd .waniwani && alpic deploy"],
	},
	{
		id: "none",
		label: "I don't know yet",
		note: "nothing written, add it later",
		deploy: [],
	},
];

export function hostById(id: string | undefined): Host {
	return HOSTS.find((host) => host.id === id) ?? (HOSTS[0] as Host);
}

/**
 * What a git-connected Vercel project needs from the repo, and nothing more.
 * See HOSTS for why this is one key.
 */
function vercelJson(): string {
	return `${JSON.stringify(
		{
			$schema: "https://openapi.vercel.sh/vercel.json",
			framework: null,
		},
		null,
		2,
	)}\n`;
}

function scaffold(
	app: ScaffoldApp,
	{ minimal, host, sdk }: { minimal: boolean; host: HostId; sdk: string },
): ScaffoldFile[] {
	const files: ScaffoldFile[] = [
		{
			path: "package.json",
			contents: packageJson(app, sdk),
			whenPresent: "merge",
			merge: mergePackageJson,
		},
		{
			path: ".gitignore",
			contents: starter("gitignore"),
			whenPresent: "merge",
			merge: mergeGitignore,
		},
		{ path: ".env.example", contents: starter("env.example"), whenPresent: "keep" },
		{ path: "README.md", contents: readme(app), whenPresent: "keep" },
		{ path: "waniwani.config.ts", contents: appConfig(app) },
		{ path: `tools/${TOOL}.ts`, contents: starter(`tools/${TOOL}.ts`) },
	];

	if (!minimal) {
		files.push(
			{ path: `widgets/${WIDGET}/widget.ts`, contents: starter(`widgets/${WIDGET}/widget.ts`) },
			{ path: `widgets/${WIDGET}/ui.tsx`, contents: starter(`widgets/${WIDGET}/ui.tsx`) },
		);
	}

	// A repo that already answers Vercel its own way keeps that answer: the file
	// may carry a region, a cron, or a `maxDuration` this has no business
	// replacing. `waniwani check` reads it and names the keys that fight the build.
	if (host === "vercel") {
		files.push({ path: "vercel.json", contents: vercelJson(), whenPresent: "keep" });
	}

	return files;
}

// -------------------------------------------------------------------- merging

/**
 * Add the scripts and dependencies an app needs to a manifest that is already
 * there, and touch nothing else. A key the repo already declares is the repo's
 * decision, including a `dev` script that runs something other than this CLI.
 *
 * @returns the keys added, for the CLI to report
 */
function mergePackageJson(file: string, contents: string): string[] {
	const existing = JSON.parse(readFileSync(file, "utf-8")) as PackageManifest;
	const generated = JSON.parse(contents) as PackageManifest;
	const added: string[] = [];

	const fold = (section: "scripts" | "dependencies"): Record<string, string> => {
		const merged: Record<string, string> = { ...existing[section] };
		for (const [key, value] of Object.entries(generated[section] ?? {})) {
			if (merged[key]) continue;
			merged[key] = value;
			added.push(`${section}.${key}`);
		}
		return merged;
	};

	const next = {
		...existing,
		// App modules are ESM. A repo that says commonjs is warned about instead of
		// rewritten, since flipping it changes how the rest of that repo loads.
		type: existing.type ?? "module",
		scripts: fold("scripts"),
		dependencies: fold("dependencies"),
	};
	if (!existing.type) added.push("type");

	if (added.length > 0) {
		writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`);
	}
	return added;
}

/**
 * Add the lines the app does not ignore yet, leaving every line it wrote alone.
 * A trailing slash is not part of the comparison, so a repo ignoring
 * `node_modules` does not gain `node_modules/` next to it.
 *
 * @returns the lines added, for the CLI to report
 */
function mergeGitignore(file: string, contents: string): string[] {
	const existing = readFileSync(file, "utf-8");
	const bare = (line: string) => line.trim().replace(/\/$/, "");
	const known = new Set(existing.split("\n").map(bare));

	const additions = contents
		.split("\n")
		.filter((line) => line.trim() && !line.trim().startsWith("#") && !known.has(bare(line)));

	if (additions.length === 0) return [];
	const prefix = !existing || existing.endsWith("\n") ? "" : "\n";
	writeFileSync(file, `${existing}${prefix}${additions.join("\n")}\n`);
	return additions;
}

// ------------------------------------------------------------------- the shell

function write(file: string, contents: string): void {
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, contents);
}

/**
 * The two shapes `init` scaffolds.
 *
 * The pair is the default because the tool-to-widget hand-off is what nobody
 * guesses from the type signatures, so the folder that demonstrates it is worth
 * more than an empty one. `--minimal` is the same answer given ahead of time.
 */
const CONTENTS: Choice<"pair" | "tool">[] = [
	{ value: "pair", label: "A tool and a widget", hint: "the hand-off between them, wired up" },
	{ value: "tool", label: "Just a tool", hint: "a config and one tool, nothing on screen" },
];

/**
 * The package manager that invoked this command, which npm, pnpm, yarn and bun
 * all announce in `npm_config_user_agent`. Nothing to detect from lockfiles: a
 * new folder has none, and a `waniwani init` inside an existing repo was still
 * typed with one of the four.
 */
function packageManager(): PackageManagerName {
	const agent = process.env.npm_config_user_agent ?? "";
	const names: PackageManagerName[] = ["bun", "pnpm", "yarn", "npm"];
	return names.find((name) => agent.startsWith(name)) ?? "npm";
}

/** How each manager runs a binary out of node_modules, for the closing lines. */
const RUNNERS: Record<PackageManagerName, string> = {
	npm: "npx",
	pnpm: "pnpm",
	yarn: "yarn",
	bun: "bunx",
};

function install(root: string, manager: PackageManagerName): Promise<boolean> {
	console.log(`\n${dim(`installing with ${manager}…`)}`);
	return new Promise<boolean>((resolvePromise) => {
		const child = spawn(manager, ["install"], {
			cwd: root,
			stdio: "inherit",
			// npm and yarn are .cmd shims on Windows, which execvp cannot run.
			shell: process.platform === "win32",
		});
		child.on("close", (code) => resolvePromise(code === 0));
		child.on("error", () => resolvePromise(false));
	});
}

/**
 * Scaffold an app folder, install its dependencies, and say what to run.
 *
 * @param appRoot the directory to scaffold, created if it does not exist
 * @param flags parsed CLI flags
 * @param options.targeted a directory was named on the command line
 * @returns a process exit code
 */
export async function init(
	appRoot: string,
	flags: Flags,
	{ targeted = true }: { targeted?: boolean } = {},
): Promise<number> {
	// One question per unanswered decision, and none at all where there is nobody
	// to answer. A flag counts as answered, which is what keeps `--name x --host
	// vercel` from stopping on a prompt it has nothing left to ask.
	const asking = canAsk() && !flags.yes;
	const suggested = slugify(basename(appRoot));

	// Started here and awaited below, so the registry round trip happens behind
	// the questions rather than in front of the first file write. It resolves to
	// null on a slow or absent network and `preferred` falls back to the declared
	// floor, so nothing about this scaffold depends on npm being reachable.
	const publishedSdk = latestVersion(SDK);
	if (asking) {
		open(bold("A new MCP app"));
	}

	// Both fields come out of the one answer: `Acme Shop` gives the server the
	// name `acme-shop` and keeps `Acme Shop` as the title. An answer that is
	// already a slug gets a title with a capital on the front.
	const named = asking && flags.name === undefined;
	const answer: string = named
		? await askText("App name", suggested, (value) =>
				value && !/[a-z0-9]/i.test(value) ? "a letter or a number, somewhere" : undefined,
			)
		: (flags.name ?? suggested);
	const name = slugify(answer);
	const typed = cleanTitle(answer);
	const app: ScaffoldApp = { name, title: typed && typed !== name ? typed : titleize(name) };

	// A name typed at the prompt with no directory to put it in names the
	// directory as well: `oney` in ~/Projects means ~/Projects/oney, which is how
	// create-next-app's one question reads. Taking the offered default leaves
	// everything where it is, since that default is the current folder's own name,
	// and `waniwani init .` names the current folder outright.
	const root = !targeted && named && name !== suggested ? join(appRoot, name) : appRoot;

	// The widget is what `--minimal` drops, so the flag and the question are the
	// same decision reached two ways.
	const minimal =
		flags.minimal !== undefined
			? Boolean(flags.minimal)
			: asking
				? (await askOne("What should it come with?", CONTENTS)) === "tool"
				: false;

	// Asked rather than assumed, because the answer decides whether the repo
	// carries a deploy file at all, and because seeing the four options is how
	// someone learns the app is not tied to one host.
	const host: HostId =
		typeof flags.host === "string"
			? hostById(flags.host).id
			: asking
				? await askOne(
						"Where will this deploy?",
						HOSTS.map((option) => ({
							value: option.id,
							label: option.label,
							hint: option.note,
						})),
					)
				: hostById(undefined).id;

	const files = scaffold(app, { minimal, host, sdk: preferred(SDK, await publishedSdk) });

	// Nothing is written until every collision is known, so a refusal leaves the
	// directory exactly as it was.
	const clashes = files.filter((file) => !file.whenPresent && existsSync(join(root, file.path)));
	if (clashes.length > 0 && !flags.force) {
		fail(bold("already an app folder here"));
		for (const file of clashes) {
			console.error(`  ${file.path}`);
		}
		console.error(`\n${dim("pass --force to overwrite, or init into a new directory")}`);
		return 1;
	}

	mkdirSync(root, { recursive: true });

	const actions: [marker: string, path: string, note: string | null][] = [];
	for (const file of files) {
		const target = join(root, file.path);

		if (!existsSync(target)) {
			write(target, file.contents);
			actions.push([green("+"), file.path, null]);
			continue;
		}
		if (file.whenPresent === "keep") {
			actions.push([dim("·"), file.path, "yours, left alone"]);
			continue;
		}
		if (file.whenPresent === "merge" && file.merge) {
			const changed = file.merge(target, file.contents);
			actions.push([
				changed.length > 0 ? yellow("~") : dim("·"),
				file.path,
				changed.length > 0 ? `+ ${changed.join(", ")}` : "nothing to add",
			]);
			continue;
		}
		// A collision the caller chose to overwrite.
		write(target, file.contents);
		actions.push([yellow("~"), file.path, "overwritten"]);
	}

	close(`${bold(app.name)} ${dim(`→ ${root}`)}`);
	for (const [marker, path, note] of actions) {
		console.log(`  ${marker} ${path}${note ? ` ${dim(note)}` : ""}`);
	}

	// The merge leaves a script the repo already had alone, so the way into the dev
	// loop is whatever survived that: `npm run dev` when it is ours, the CLI by
	// name when the repo's own `dev` runs something else.
	const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf-8")) as PackageManifest;
	const ours = manifest.scripts?.dev === "waniwani dev";

	if (manifest.type !== "module") {
		console.log(
			`\n${yellow("!")} ${bold("package.json")} says ${bold(`"type": "${manifest.type}"`)}`,
		);
		console.log(
			`  ${dim('app modules are ESM: set it to "module" or the build cannot load them')}`,
		);
	}

	const manager = packageManager();
	// A scaffold with no node_modules still checks out and still reads, so a
	// failed install is reported and the folder is kept.
	const installed = flags.install === false ? null : await install(root, manager);

	console.log(`\n${bold("From here")}`);
	// `init apps/store` is scaffolded two levels down, so the path is the one to
	// print rather than the directory's own name.
	const from = relative(process.cwd(), root);
	if (from) {
		console.log(`  cd ${from}`);
	}
	if (installed === false) {
		console.log(`  ${yellow(`${manager} install`)} ${dim("(the first attempt failed)")}`);
	} else if (installed === null) {
		console.log(`  ${manager} install`);
	}
	console.log(`  ${ours ? `${manager} run dev` : `${RUNNERS[manager]} waniwani dev`}`);

	console.log(`\n${bold("Then")}`);
	console.log(`  ${dim("·")} edit ${bold(`tools/${TOOL}.ts`)} to answer with your own data`);
	if (!minimal) {
		console.log(
			`  ${dim("·")} edit ${bold(`widgets/${WIDGET}/ui.tsx`)} for how it looks on screen`,
		);
	}
	console.log(`  ${dim("·")} add ${bold("flows/<name>.ts")} for a multi-step conversation`);

	const target = hostById(host);
	if (target.deploy.length > 0) {
		console.log(`\n${bold(`Deploying to ${target.label}`)}`);
		for (const line of target.deploy) {
			console.log(`  ${line}`);
		}
	} else {
		console.log(`\n${bold("Deploying")}`);
		console.log(`  ${dim("·")} rerun with ${bold("--host vercel")} for the one file Vercel needs`);
	}
	return 0;
}
