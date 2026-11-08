/**
 * One app folder's view of the Waniwani platform: which instance it talks to,
 * the session it talks with, and the requests it makes.
 *
 * Every request is made as the developer, with the OAuth session from
 * `waniwani login`. The app's `WANIWANI_API_KEY` is never sent: it belongs to
 * one agent and is meant for the SDK's tracking calls, while `connect` and
 * `dev` list orgs and agents, which only a person may do.
 */

import { PROJECT_FILE, readProject } from "./project.js";
import { REGIONS, readSettings, type Settings, withoutSession, writeSettings } from "./settings.js";
import { yellow } from "./ui.js";

/** A failure with a sentence a developer can act on. Printed without a stack trace. */
export class PlatformError extends Error {
	constructor(
		message: string,
		readonly status?: number,
	) {
		super(message);
		this.name = "PlatformError";
	}
}

/** The platform's envelope. Errors come back in more than one shape. */
interface Envelope<T> {
	data?: T;
	error?: string | { code?: string; message?: string };
	message?: string;
}

interface TokenResponse {
	access_token: string;
	refresh_token: string;
	expires_in: number;
}

/**
 * `WANIWANI_API_URL` as the shell set it. Read when this module loads, which is
 * before either binary reads the app's `.env`: both import this package
 * statically and load `.env` inside their main function.
 */
const SHELL_API_URL = process.env.WANIWANI_API_URL;

/** Refresh this long before the stored expiry, so a request never races it. */
const EXPIRY_MARGIN_MS = 5 * 60 * 1000;

export class Platform {
	private settings: Settings;

	/**
	 * `shellApiUrl` is `WANIWANI_API_URL` as the shell set it, before any `.env`
	 * was read. Tests pass it; everything else takes the default.
	 */
	constructor(
		readonly root: string,
		private readonly shellApiUrl: string | undefined = SHELL_API_URL,
	) {
		this.settings = readSettings(root);
	}

	/**
	 * `WANIWANI_API_URL`, then the app's `waniwani.json`, then the instance from
	 * login.
	 *
	 * The instance receives the login and decides where the tunnel sends the
	 * local server, so it is never taken freely from a file a cloned repo can
	 * carry. Any host goes when the person running the command sets it in the
	 * shell. A `WANIWANI_API_URL` that only a `.env` file set, and an `apiUrl` in
	 * `waniwani.json`, count only when they name a Waniwani instance.
	 */
	apiUrl(): string {
		return (this.shellApiUrl || this.fromRepo() || this.settings.apiUrl).replace(/\/+$/, "");
	}

	/** Whether the instance was named by something other than the stored settings. */
	apiUrlIsOverridden(): boolean {
		return Boolean(this.shellApiUrl || this.fromRepo());
	}

	/** The instance the repo names, through its `.env` or its `waniwani.json`. */
	private fromRepo(): string | undefined {
		const fromEnvFile = process.env.WANIWANI_API_URL;
		if (fromEnvFile) return this.known(fromEnvFile, "WANIWANI_API_URL from a .env file");
		const fromProject = readProject(this.root)?.apiUrl;
		if (fromProject) return this.known(fromProject, `apiUrl in ${PROJECT_FILE}`);
		return undefined;
	}

	/** `raw` as an origin when it is a Waniwani instance; otherwise a warning, once, and nothing. */
	private known(raw: string, source: string): string | undefined {
		const instances = Object.values(REGIONS).map((region) => region.apiUrl);
		let origin = "";
		try {
			origin = new URL(raw).origin;
		} catch {
			// Not a URL: falls through to the warning.
		}
		if (instances.includes(origin)) return origin;
		if (!this.warned.has(source)) {
			this.warned.add(source);
			console.error(
				`${yellow("!")} ${source} is ${raw}, which is not a Waniwani instance — ignored; export WANIWANI_API_URL in your shell to use it`,
			);
		}
		return undefined;
	}

	private readonly warned = new Set<string>();

	region(): Settings["region"] {
		return this.settings.region;
	}

	setRegion(region: NonNullable<Settings["region"]>, apiUrl: string): void {
		this.save({ ...this.settings, region, apiUrl });
	}

	/**
	 * A session issued by the instance this folder targets. A session from
	 * another instance (a login against EU, then a repo pinned to US) counts as
	 * none, so the caller logs in again instead of sending the wrong token.
	 */
	hasSession(): boolean {
		return Boolean(this.settings.accessToken) && this.settings.apiUrl === this.apiUrl();
	}

	sessionExpired(): boolean {
		const { expiresAt } = this.settings;
		if (!expiresAt) return true;
		return new Date(expiresAt).getTime() - EXPIRY_MARGIN_MS < Date.now();
	}

	storeSession(tokens: TokenResponse, clientId: string, apiUrl: string): void {
		this.save({
			...this.settings,
			apiUrl,
			clientId,
			accessToken: tokens.access_token,
			refreshToken: tokens.refresh_token,
			expiresAt: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
		});
	}

	clearSession(): void {
		this.save(withoutSession(this.settings));
	}

	/**
	 * Swap the refresh token for a new pair. A refusal clears the session: a
	 * refresh token the server rejected once will be rejected again.
	 */
	async refresh(): Promise<boolean> {
		const { refreshToken, clientId } = this.settings;
		if (!refreshToken || !clientId) return false;
		const apiUrl = this.apiUrl();
		try {
			const response = await fetch(`${apiUrl}/api/auth/oauth2/token`, {
				method: "POST",
				headers: { "Content-Type": "application/x-www-form-urlencoded" },
				body: new URLSearchParams({
					grant_type: "refresh_token",
					refresh_token: refreshToken,
					client_id: clientId,
					// RFC 8707. Without it the server issues an opaque token, which the
					// API's JWT check rejects.
					resource: apiUrl,
				}),
			});
			if (!response.ok) {
				this.clearSession();
				return false;
			}
			this.storeSession((await response.json()) as TokenResponse, clientId, apiUrl);
			return true;
		} catch {
			this.clearSession();
			return false;
		}
	}

	get<T>(path: string): Promise<T> {
		return this.request<T>("GET", path);
	}

	post<T>(path: string, body: unknown = {}): Promise<T> {
		return this.request<T>("POST", path, body);
	}

	patch<T>(path: string, body: unknown = {}): Promise<T> {
		return this.request<T>("PATCH", path, body);
	}

	delete<T>(path: string): Promise<T> {
		return this.request<T>("DELETE", path);
	}

	private async request<T>(
		method: string,
		path: string,
		body?: unknown,
		retried = false,
	): Promise<T> {
		const token = this.settings.accessToken;
		if (!token) {
			throw new PlatformError("not logged in — run `waniwani login`");
		}
		const response = await fetch(`${this.apiUrl()}${path}`, {
			method,
			headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
			body: body === undefined ? undefined : JSON.stringify(body),
		});

		if (response.status === 401) {
			if (!retried && (await this.refresh())) {
				return this.request<T>(method, path, body, true);
			}
			throw new PlatformError("session expired — run `waniwani login`", 401);
		}
		if (response.status === 204) {
			return undefined as T;
		}

		const raw = await response.text();
		let envelope: Envelope<T>;
		try {
			envelope = JSON.parse(raw) as Envelope<T>;
		} catch {
			throw new PlatformError(
				`${method} ${path} failed with ${response.status}${raw ? `: ${raw.slice(0, 200)}` : ""}`,
				response.status,
			);
		}
		if (!response.ok || envelope.error) {
			const message =
				(typeof envelope.error === "object" ? envelope.error.message : envelope.error) ||
				envelope.message ||
				`request failed with ${response.status}`;
			throw new PlatformError(`${method} ${path}: ${message}`, response.status);
		}
		return envelope.data as T;
	}

	private save(settings: Settings): void {
		this.settings = settings;
		writeSettings(settings);
	}
}
