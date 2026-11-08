/**
 * Hand an http(s) URL to the system browser, detached, ignoring a machine that
 * has none.
 *
 * No shell parses the URL on any platform. On Windows, `cmd /c start` would:
 * part of the URL comes from a committed `waniwani.json`, and `&` in it would
 * start a second command. `rundll32 url.dll,FileProtocolHandler` takes the URL
 * as one argument.
 */

import { spawn } from "node:child_process";

export function openBrowser(raw: string): void {
	let url: string;
	try {
		const parsed = new URL(raw);
		if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return;
		url = parsed.toString();
	} catch {
		return;
	}
	const [command, ...args] =
		process.platform === "darwin"
			? ["open", url]
			: process.platform === "win32"
				? ["rundll32", "url.dll,FileProtocolHandler", url]
				: ["xdg-open", url];
	try {
		const child = spawn(command as string, args, { stdio: "ignore", detached: true });
		child.on("error", () => {});
		child.unref();
	} catch {
		// The URL is always printed as well.
	}
}
