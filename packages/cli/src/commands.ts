/**
 * The commands that talk to the Waniwani platform: `login`, `logout`,
 * `switch`, `connect`, and `dev` for a server that is not a kit app. Each
 * returns the exit code.
 *
 * `runPlatform` is the one entry point. This package's binary calls it, and so
 * does `@waniwani/kit`'s, which is how both `waniwani` binaries answer these
 * commands the same way.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { resolve } from "node:path";
import { type Flags, parseArgs, stringFlag } from "./args.js";
import { Platform, PlatformError } from "./client.js";
import { connect, findAgent } from "./connect.js";
import { plan } from "./link.js";
import { ensureRegion, ensureSession, login } from "./login.js";
import { findOrg, listOrgs, pickOrg, switchOrg } from "./orgs.js";
import { readProject } from "./project.js";
import { devScript, NESTED_DEV } from "./script.js";
import { serve } from "./serve.js";
import { settingsFile } from "./settings.js";
import { askYesNo, bold, canAsk, close, dim, green, open } from "./ui.js";

/** The commands `runPlatform` answers. `dev` is answered too, for a folder that is not a kit app. */
export const PLATFORM_COMMANDS: ReadonlySet<string> = new Set([
	"login",
	"logout",
	"switch",
	"connect",
]);

/**
 * Run one platform command from its argv (`["login", "--region", "eu"]`) and
 * return the exit code. A `PlatformError` thrown out of here carries a sentence
 * the caller prints as it is.
 */
export async function runPlatform(argv: string[]): Promise<number> {
	const [command = "dev", ...rest] = argv;
	const { flags, positional } = parseArgs(rest);
	// `switch` is the one command whose positional is not a directory.
	const root = resolve(command === "switch" ? "." : (positional[0] ?? "."));
	switch (command) {
		case "login":
			return loginCommand(root, flags);
		case "logout":
			return logoutCommand(root);
		case "switch":
			return switchCommand(root, flags, positional[0]);
		case "connect":
			return connectCommand(root, flags);
		case "dev":
			return devCommand(root, flags);
		default:
			throw new PlatformError(`unknown command: ${command}`);
	}
}

function region(flags: Flags): string | undefined {
	return stringFlag(flags, "region");
}

function interactive(command: string): void {
	if (!canAsk()) {
		throw new PlatformError(`\`waniwani ${command}\` asks questions — run it in a terminal`);
	}
}

export async function loginCommand(root: string, flags: Flags): Promise<number> {
	const platform = new Platform(root);
	await ensureRegion(platform, region(flags));
	if (platform.hasSession() && !platform.sessionExpired()) {
		console.log(`${green("✓")} already logged in to ${platform.apiUrl()}`);
		console.log(dim("run `waniwani logout` first to log in as someone else"));
		return 0;
	}
	if (platform.hasSession() && (await platform.refresh())) {
		console.log(`${green("✓")} session refreshed for ${platform.apiUrl()}`);
		return 0;
	}
	await login(platform, { browser: flags.browser !== false });
	console.log(`${green("✓")} logged in to ${platform.apiUrl()}`);
	console.log(dim(`  credentials in ${settingsFile()}`));

	// A member of several orgs picks the one the CLI acts in. Nobody else is asked.
	if (canAsk()) {
		const orgs = await listOrgs(platform);
		if (orgs.orgs.length > 1) {
			open("waniwani login");
			const org = await pickOrg(orgs);
			if (org.id !== orgs.activeOrgId) await switchOrg(platform, org.id);
			close(`organization ${bold(org.name)}`);
		}
	}
	console.log(`\n${dim("next:")} waniwani connect ${dim("— link this folder to an agent")}`);
	return 0;
}

export async function logoutCommand(root: string): Promise<number> {
	const platform = new Platform(root);
	if (!platform.hasSession()) {
		console.log(dim("not logged in"));
		return 0;
	}
	platform.clearSession();
	console.log(`${green("✓")} logged out of ${platform.apiUrl()}`);
	return 0;
}

/** `waniwani switch [org]`, by name, slug or ID, or picked from a list. */
export async function switchCommand(
	root: string,
	flags: Flags,
	target: string | undefined,
): Promise<number> {
	const platform = new Platform(root);
	await ensureSession(platform, { region: region(flags) });
	const orgs = await listOrgs(platform);
	let org: ReturnType<typeof findOrg>;
	if (target) {
		org = findOrg(orgs.orgs, target);
	} else {
		interactive("switch");
		open("waniwani switch");
		org = await pickOrg(orgs);
		close(`organization ${bold(org.name)}`);
	}
	if (org.id === orgs.activeOrgId) {
		console.log(`${green("✓")} already in ${bold(org.name)}`);
		return 0;
	}
	await switchOrg(platform, org.id);
	console.log(`${green("✓")} switched to ${bold(org.name)}`);
	return 0;
}

export async function connectCommand(root: string, flags: Flags): Promise<number> {
	interactive("connect");
	const platform = new Platform(root);
	await ensureSession(platform, { region: region(flags) });

	const linked = readProject(root)?.projectId;
	open("waniwani connect");
	if (linked) {
		const agent = await findAgent(platform, linked);
		if (agent) {
			console.log(`${dim("linked to")} ${bold(agent.name)} ${dim(`(${agent.hosting})`)}`);
			if (!(await askYesNo("Link this folder to another agent?", false))) {
				close("nothing changed");
				return 0;
			}
		} else {
			console.log(dim(`waniwani.json names agent ${linked}, which this account cannot see`));
		}
	}
	const agent = await connect(platform);
	close(
		agent.hosting === "managed"
			? `linked — run ${bold("waniwani dev")} to try it in the playground; a push to the tracked branch deploys it`
			: `linked — run ${bold("waniwani dev")} to try it in the playground; set WANIWANI_API_KEY where your server runs`,
	);
	return 0;
}

/**
 * `waniwani dev` in a folder that is not a kit app: run the folder's own `dev`
 * script under its package manager, with the port in `PORT`, and link it.
 * `--no-connect` runs the script as it is, with no port and no link.
 */
export async function devCommand(root: string, flags: Flags): Promise<number> {
	if (process.env[NESTED_DEV]) {
		throw new PlatformError(
			"the `dev` script started `waniwani dev` again — point it at your server, not at waniwani",
		);
	}
	const script = devScript(root);
	if (!script) {
		throw new PlatformError(
			"nothing to run here — add a `dev` script to package.json that starts your MCP server on PORT",
		);
	}
	const platform = new Platform(root);
	const link = await plan(platform, flags, { required: flags.connect !== false });
	const [manager, args] = script;
	const env = link ? { PORT: String(link.port) } : {};
	console.log(
		dim(`running ${manager} ${args.join(" ")}${link ? ` with PORT=${link.port}` : ""}\n`),
	);

	let child: ChildProcess;
	const exited = new Promise<number>((resolveExit) => {
		child = spawn(manager, args, {
			cwd: root,
			stdio: "inherit",
			env: { ...process.env, ...env, [NESTED_DEV]: "1" },
			// Package managers ship as `.cmd` shims on Windows, which only a shell runs.
			shell: process.platform === "win32",
		});
		child.on("close", (code) => resolveExit(code ?? 1));
		child.on("error", (error) => {
			console.error(`failed to run ${manager}: ${error.message}`);
			resolveExit(1);
		});
	});
	return serve(exited, platform, link, {
		stopChildren: () => {
			if (child.exitCode === null) child.kill("SIGTERM");
		},
	});
}
