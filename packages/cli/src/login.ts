/**
 * `waniwani login`: an OAuth 2 authorization-code flow with PKCE, against the
 * instance this folder targets.
 *
 * The CLI registers itself as a public client, opens the browser on the
 * authorize page, and waits on a loopback port for the redirect. No secret is
 * involved: the code verifier, which never leaves this process, is what proves
 * the redirect came back to the program that asked for it.
 */

import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { Socket } from "node:net";
import { type Platform, PlatformError } from "./client.js";
import { openBrowser } from "./open.js";
import { bindOrg } from "./orgs.js";
import { REGIONS, type Region } from "./settings.js";
import { askOne, canAsk, dim, green, task } from "./ui.js";

const CALLBACK_PORT = 54321;
const CALLBACK_URL = `http://localhost:${CALLBACK_PORT}/callback`;
const CLIENT_NAME = "waniwani-cli";
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

interface TokenResponse {
	access_token: string;
	refresh_token: string;
	expires_in: number;
}

function base64url(bytes: Buffer): string {
	return bytes.toString("base64url");
}

/**
 * Settle which instance to talk to before anything authenticates, because a
 * session is bound to the instance that issued it.
 *
 * `--region` wins and is stored. An instance named by `WANIWANI_API_URL` or the
 * app's `waniwani.json`, or one picked on an earlier run, is used as is. Only a
 * first run with none of those asks.
 */
export async function ensureRegion(platform: Platform, flag?: string): Promise<void> {
	if (flag !== undefined) {
		const region = flag.trim().toLowerCase();
		if (region !== "us" && region !== "eu") {
			throw new PlatformError(`unknown region "${flag}" — use us or eu`);
		}
		platform.setRegion(region, REGIONS[region].apiUrl);
		return;
	}
	if (platform.apiUrlIsOverridden() || platform.region()) return;
	if (!canAsk()) {
		throw new PlatformError("no instance picked yet — pass --region us or --region eu");
	}
	const region = await askOne<Region>(
		"Which Waniwani instance?",
		(Object.keys(REGIONS) as Region[]).map((id) => ({
			value: id,
			label: REGIONS[id].label,
			hint: REGIONS[id].apiUrl,
		})),
	);
	platform.setRegion(region, REGIONS[region].apiUrl);
}

/** A page for the browser tab the redirect lands in. Static text, nothing interpolated from the request. */
function page(title: string, message: string): string {
	return [
		"<!doctype html>",
		'<html lang="en"><head><meta charset="utf-8">',
		'<meta name="viewport" content="width=device-width, initial-scale=1">',
		`<title>${title} · Waniwani</title>`,
		"<style>body{font-family:system-ui,sans-serif;min-height:100vh;margin:0;display:grid;place-items:center;background:#fafafa;color:#1e293b;text-align:center}p{color:#64748b}</style>",
		`</head><body><main><h1>${title}</h1><p>${message}</p></main></body></html>`,
	].join("\n");
}

/** Wait for the authorize redirect on the loopback port and return its code. */
function waitForCode(expectedState: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const sockets = new Set<Socket>();
		let server: Server | null = null;

		const finish = (error: Error | null, code?: string) => {
			clearTimeout(timer);
			for (const socket of sockets) socket.destroy();
			server?.close();
			if (error) reject(error);
			else resolve(code as string);
		};
		const timer = setTimeout(
			() => finish(new PlatformError("login timed out — run `waniwani login` again")),
			LOGIN_TIMEOUT_MS,
		);

		server = createServer((req, res) => {
			const url = new URL(req.url ?? "/", CALLBACK_URL);
			if (url.pathname !== "/callback") {
				res.statusCode = 404;
				res.end();
				return;
			}
			res.setHeader("Content-Type", "text/html; charset=utf-8");
			const code = url.searchParams.get("code");
			const failure = url.searchParams.get("error")
				? "the authorization was refused"
				: url.searchParams.get("state") !== expectedState
					? "the response did not match this login"
					: !code
						? "no authorization code came back"
						: null;
			if (failure) {
				res.statusCode = 400;
				res.end(page("Login failed", "Run waniwani login again from your terminal."));
				finish(new PlatformError(`login failed: ${failure}`));
				return;
			}
			res.end(page("Logged in", "You can close this tab and go back to your terminal."));
			// Let the response flush before the sockets are destroyed.
			setTimeout(() => finish(null, code as string), 100);
		});
		server.on("connection", (socket) => {
			sockets.add(socket);
			socket.on("close", () => sockets.delete(socket));
		});
		server.on("error", (error: NodeJS.ErrnoException) => {
			finish(
				error.code === "EADDRINUSE"
					? new PlatformError(
							`port ${CALLBACK_PORT} is in use — another \`waniwani login\` is probably waiting`,
						)
					: error,
			);
		});
		server.listen(CALLBACK_PORT);
	});
}

async function postJson<T>(url: string, body: Record<string, unknown>, what: string): Promise<T> {
	const response = await fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
	if (!response.ok) {
		const detail = (await response.json().catch(() => ({}))) as { error_description?: string };
		throw new PlatformError(`${what} failed: ${detail.error_description ?? response.status}`);
	}
	return (await response.json()) as T;
}

/**
 * Run the whole flow and store the session. Prints the authorize URL as well as
 * opening it, so a machine with no browser can still finish from another one.
 */
export async function login(platform: Platform, { browser = true } = {}): Promise<void> {
	const apiUrl = platform.apiUrl();
	const { client_id: clientId } = await postJson<{ client_id: string }>(
		`${apiUrl}/api/auth/oauth2/register`,
		{
			client_name: CLIENT_NAME,
			redirect_uris: [CALLBACK_URL],
			grant_types: ["authorization_code", "refresh_token"],
			response_types: ["code"],
			token_endpoint_auth_method: "none",
		},
		"client registration",
	);

	const verifier = base64url(randomBytes(32));
	const challenge = base64url(createHash("sha256").update(verifier).digest());
	const state = randomBytes(16).toString("hex");

	const authorize = new URL(`${apiUrl}/api/auth/oauth2/authorize`);
	for (const [key, value] of Object.entries({
		client_id: clientId,
		redirect_uri: CALLBACK_URL,
		response_type: "code",
		code_challenge: challenge,
		code_challenge_method: "S256",
		state,
		// RFC 8707: ask for a JWT access token scoped to this instance.
		resource: apiUrl,
	})) {
		authorize.searchParams.set(key, value);
	}

	const code = waitForCode(state);
	console.log(`\n${dim("Log in in your browser. If it does not open, visit:")}`);
	console.log(`  ${green(authorize.toString())}\n`);
	if (browser) openBrowser(authorize.toString());

	const progress = task("Waiting for the browser");
	try {
		const tokens = await fetch(`${apiUrl}/api/auth/oauth2/token`, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				grant_type: "authorization_code",
				code: await code,
				redirect_uri: CALLBACK_URL,
				client_id: clientId,
				code_verifier: verifier,
				resource: apiUrl,
			}),
		});
		if (!tokens.ok) {
			const detail = (await tokens.json().catch(() => ({}))) as { error_description?: string };
			throw new PlatformError(
				`token exchange failed: ${detail.error_description ?? tokens.status}`,
			);
		}
		platform.storeSession((await tokens.json()) as TokenResponse, clientId, apiUrl);
		progress.done("Logged in");
	} catch (error) {
		progress.failed("Login failed");
		throw error;
	}

	// Pin the session to the org the server resolved, so an org switch in the web
	// app does not move it. Best effort: an unbound session acts in the user's
	// active org, and the next `switch` or `connect` binds it.
	try {
		const { orgs, activeOrgId } = await platform.get<{
			orgs: { id: string }[];
			activeOrgId: string | null;
		}>("/api/oauth/orgs");
		const orgId = activeOrgId ?? (orgs.length === 1 ? orgs[0]?.id : undefined);
		if (orgId) await bindOrg(platform, orgId);
	} catch {
		// See above.
	}
}

/**
 * A live session for the commands that act as the developer, logging in when
 * there is none. A session that only needs a refresh never opens a browser.
 */
export async function ensureSession(platform: Platform, flags: { region?: string }): Promise<void> {
	await ensureRegion(platform, flags.region);
	if (platform.hasSession() && (!platform.sessionExpired() || (await platform.refresh()))) {
		return;
	}
	if (!canAsk()) {
		throw new PlatformError("not logged in — run `waniwani login` in a terminal first");
	}
	console.log(dim("Not logged in yet."));
	await login(platform);
}
