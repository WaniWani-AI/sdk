/**
 * The Cloudflare tunnel `waniwani dev` serves the local server through.
 *
 * Each agent has a named tunnel with a stable `<slug>.waniwani.dev` hostname,
 * created with the agent. Starting a dev session repoints that tunnel at the
 * local port and returns a connector token; `cloudflared` run with that token is
 * the whole client side. The playground's backend runs on Vercel and cannot
 * reach `localhost`, and neither can ChatGPT or Claude, so the hostname is what
 * all of them call.
 *
 * The binary is fetched from Cloudflare's GitHub releases on first use and kept
 * in `~/.cache/waniwani/bin/`. It is not a package dependency: every install of
 * the kit (a Vercel build included) would download a platform binary that only
 * a linked `dev` uses. A `cloudflared` already on PATH is used as is.
 */

import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { PlatformError } from "./client.js";
import { task } from "./ui.js";

const RELEASES = "https://github.com/cloudflare/cloudflared/releases/latest/download";
const READY_TIMEOUT_MS = 30_000;

/** The release asset for this machine, as Cloudflare names it. */
function asset(): string {
	const { platform, arch } = process;
	const name =
		platform === "linux"
			? {
					x64: "cloudflared-linux-amd64",
					arm64: "cloudflared-linux-arm64",
					arm: "cloudflared-linux-arm",
				}[arch as string]
			: platform === "darwin"
				? { x64: "cloudflared-darwin-amd64.tgz", arm64: "cloudflared-darwin-arm64.tgz" }[
						arch as string
					]
				: platform === "win32"
					? { x64: "cloudflared-windows-amd64.exe" }[arch as string]
					: undefined;
	if (!name) {
		throw new PlatformError(
			`no cloudflared build for ${platform}/${arch} — install cloudflared and put it on PATH`,
		);
	}
	return name;
}

function onPath(): boolean {
	return spawnSync("cloudflared", ["--version"], { stdio: "ignore" }).status === 0;
}

async function download(to: string): Promise<void> {
	const name = asset();
	const response = await fetch(`${RELEASES}/${name}`);
	if (!response.ok) {
		throw new PlatformError(`could not download cloudflared (${response.status})`);
	}
	const bytes = Buffer.from(await response.arrayBuffer());
	if (!name.endsWith(".tgz")) {
		writeFileSync(to, bytes, { mode: 0o755 });
		return;
	}
	const dir = join(to, "..");
	const archive = join(dir, name);
	writeFileSync(archive, bytes);
	const untar = spawnSync("tar", ["-xzf", name], { cwd: dir, stdio: "ignore" });
	rmSync(archive, { force: true });
	if (untar.status !== 0) {
		throw new PlatformError("could not unpack the cloudflared download");
	}
	// The archive holds one file named `cloudflared`, which is already `to`
	// unless the caller chose another name.
	const extracted = join(dir, "cloudflared");
	if (extracted !== to) renameSync(extracted, to);
	chmodSync(to, 0o755);
}

/** A runnable `cloudflared`, downloading it once if neither PATH nor the cache has one. */
async function binary(): Promise<string> {
	if (onPath()) return "cloudflared";
	const dir = join(homedir(), ".cache", "waniwani", "bin");
	const path = join(dir, process.platform === "win32" ? "cloudflared.exe" : "cloudflared");
	if (existsSync(path)) return path;

	mkdirSync(dir, { recursive: true });
	const progress = task("Downloading cloudflared (once)");
	try {
		await download(path);
	} catch (error) {
		progress.failed("Could not download cloudflared");
		throw error;
	}
	progress.done(`cloudflared saved to ${path}`);
	return path;
}

export interface Tunnel {
	url: string;
	stop(): void;
}

/**
 * Run the agent's tunnel with a connector token from the platform. Resolves
 * once `cloudflared` reports an edge connection, since traffic sent earlier
 * would race the connector coming up.
 */
export async function startTunnel({
	hostname,
	token,
}: {
	hostname: string;
	token: string;
}): Promise<Tunnel> {
	const bin = await binary();
	// The token goes in the environment, which `tunnel run` reads as TUNNEL_TOKEN.
	// On the command line, any user on the machine could read it with `ps`.
	const child = spawn(bin, ["tunnel", "--no-autoupdate", "run"], {
		env: { ...process.env, TUNNEL_TOKEN: token },
		stdio: ["ignore", "pipe", "pipe"],
	});

	return new Promise<Tunnel>((resolve, reject) => {
		let settled = false;
		const settle = (error: Error | null) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			if (error) {
				child.kill("SIGTERM");
				reject(error);
				return;
			}
			resolve({
				url: `https://${hostname}`,
				stop: () => {
					if (child.exitCode === null) child.kill("SIGTERM");
				},
			});
		};
		const timer = setTimeout(
			() =>
				settle(new PlatformError(`cloudflared did not connect within ${READY_TIMEOUT_MS / 1000}s`)),
			READY_TIMEOUT_MS,
		);
		// Logged once per edge connection; the first one means traffic flows.
		const watch = (chunk: Buffer) => {
			if (chunk.toString().includes("Registered tunnel connection")) settle(null);
		};
		child.stdout.on("data", watch);
		child.stderr.on("data", watch);
		child.once("error", (error) => settle(error));
		child.once("exit", (code) =>
			settle(new PlatformError(`cloudflared exited with code ${code ?? "?"} before connecting`)),
		);
	});
}
