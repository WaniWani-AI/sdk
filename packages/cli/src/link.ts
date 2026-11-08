/**
 * `waniwani dev`, linked: the local server reachable through the agent's tunnel,
 * and the platform's playground pointed at it.
 *
 * Two phases, because they sit on either side of the server starting. `plan`
 * runs first and does everything that can ask a question (instance, login,
 * which agent) and picks the port, so no prompt lands in the middle of server
 * output. `goLive` runs once the server is starting: it waits for the port to
 * answer, opens the tunnel, registers a dev session and keeps it alive.
 */

import { createServer } from "node:net";
import type { Flags } from "./args.js";
import { type Platform, PlatformError } from "./client.js";
import { connect } from "./connect.js";
import { ensureSession } from "./login.js";
import { openBrowser } from "./open.js";
import { readProject } from "./project.js";
import { startTunnel, type Tunnel } from "./tunnel.js";
import { canAsk, dim, endpoint, task } from "./ui.js";

const DEFAULT_PORT = 3000;
const PORT_ATTEMPTS = 20;
const READY_TIMEOUT_MS = 30_000;
const READY_POLL_MS = 500;
const HEARTBEAT_MS = 30_000;
const SESSION_DELETE_TIMEOUT_MS = 2_000;

export interface LinkPlan {
	projectId: string;
	port: number;
}

/** True when nothing else holds the port, on any interface. */
function portFree(port: number): Promise<boolean> {
	return new Promise((resolve) => {
		const probe = createServer();
		probe.once("error", () => resolve(false));
		probe.once("listening", () => probe.close(() => resolve(true)));
		// The wildcard address, which is where Node servers bind by default; a
		// probe on 127.0.0.1 misses a server already listening on `::`.
		probe.listen(port);
	});
}

async function choosePort(flag: string | boolean | undefined, start: number): Promise<number> {
	if (typeof flag === "string") {
		const port = Number(flag);
		if (!Number.isInteger(port) || port < 1 || port > 65535) {
			throw new PlatformError(`--port ${flag} is not a port number`);
		}
		if (!(await portFree(port))) {
			throw new PlatformError(`port ${port} is in use — free it or pass another --port`);
		}
		return port;
	}
	for (let port = start; port < start + PORT_ATTEMPTS; port++) {
		if (await portFree(port)) return port;
	}
	throw new PlatformError(`no free port between ${start} and ${start + PORT_ATTEMPTS - 1}`);
}

/**
 * Whether this `dev` links to the platform, and if so, to which agent on which
 * port. Null means a local-only run.
 *
 * An app whose `waniwani.json` names an agent links unless `--no-connect` says
 * not to; `--connect` links an app that has none, running `connect` first.
 * `required` is for a folder that is not a kit app, where linking is the only
 * thing `dev` adds.
 */
export async function plan(
	platform: Platform,
	flags: Flags,
	{ required }: { required: boolean },
): Promise<LinkPlan | null> {
	const project = readProject(platform.root);
	const wanted =
		required || flags.connect === true || (flags.connect !== false && project?.projectId);
	if (!wanted) return null;

	if (!canAsk() && !project?.projectId) {
		throw new PlatformError("this folder is not linked to an agent — run `waniwani connect` first");
	}
	await ensureSession(platform, {
		region: typeof flags.region === "string" ? flags.region : undefined,
	});
	const projectId = project?.projectId ?? (await connect(platform)).id;
	const start = project?.devPort ?? DEFAULT_PORT;
	const port = await choosePort(flags.port, start);
	if (flags.port === undefined && port !== start) {
		console.log(dim(`port ${start} is in use — using ${port}`));
	}
	return { projectId, port };
}

/** Resolves once anything answers on the port, or rejects when `exited` settles first. */
async function waitForServer(port: number, exited: Promise<number>): Promise<void> {
	let gone = false;
	void exited.then(() => {
		gone = true;
	});
	const deadline = Date.now() + READY_TIMEOUT_MS;
	while (Date.now() < deadline) {
		if (gone) throw new PlatformError("the dev server exited before it started listening");
		try {
			await fetch(`http://localhost:${port}/`);
			return;
		} catch {
			await new Promise((resolve) => setTimeout(resolve, READY_POLL_MS));
		}
	}
	throw new PlatformError(
		`nothing answered on port ${port} within ${READY_TIMEOUT_MS / 1000}s — the server has to listen on PORT=${port}`,
	);
}

export interface Live {
	/** Close the tunnel and end the dev session. Safe to call twice. */
	stop(): Promise<void>;
}

/**
 * Put the running server on the agent's tunnel and point the playground at it.
 * `exited` is the dev server's own exit, so a server that dies during startup
 * fails this rather than leaving it polling for thirty seconds.
 */
export async function goLive(
	platform: Platform,
	{ projectId, port }: LinkPlan,
	exited: Promise<number>,
): Promise<Live> {
	let tunnel: Tunnel | null = null;
	let sessionId: string | null = null;
	let heartbeat: NodeJS.Timeout | undefined;
	let stopped = false;

	const stop = async () => {
		if (stopped) return;
		stopped = true;
		clearInterval(heartbeat);
		if (sessionId) {
			// Bounded, so Ctrl-C never hangs on a slow network. A session nobody
			// deletes expires on the server when its heartbeats stop.
			await Promise.race([
				platform.delete(`/api/mcp/projects/${projectId}/dev-session/${sessionId}`).catch(() => {}),
				new Promise((resolve) => setTimeout(resolve, SESSION_DELETE_TIMEOUT_MS)),
			]);
		}
		tunnel?.stop();
	};

	try {
		await waitForServer(port, exited);

		const progress = task("Opening the tunnel");
		try {
			const credentials = await platform.post<{ hostname: string; token: string }>(
				`/api/mcp/projects/${projectId}/tunnel`,
				{ port },
			);
			tunnel = await startTunnel(credentials);
		} catch (error) {
			progress.failed("Could not open the tunnel");
			throw error;
		}
		progress.done("Tunnel open");

		// A liveness signal: while it is fresh, the playground routes this
		// developer's chats to the tunnel instead of the deployed agent.
		const session = await platform.post<{ id: string }>(
			`/api/mcp/projects/${projectId}/dev-session`,
		);
		sessionId = session.id;
		heartbeat = setInterval(() => {
			platform.patch(`/api/mcp/projects/${projectId}/dev-session/${session.id}`).catch(() => {
				// Best effort. A missed beat lets the playground fall back to the deployed agent.
			});
		}, HEARTBEAT_MS);
		heartbeat.unref();

		const playground = `${platform.apiUrl()}/agents/${projectId}/playground?localMode=1`;
		console.log(endpoint("tunnel", tunnel.url));
		console.log(endpoint("chat", playground));
		openBrowser(playground);
	} catch (error) {
		await stop();
		throw error;
	}
	return { stop };
}
