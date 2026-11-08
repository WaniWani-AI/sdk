/**
 * Wait out a dev server, linked to the platform when there is a link plan.
 * Shared by this package's `dev` and the kit's.
 */

import type { Platform } from "./client.js";
import { goLive, type LinkPlan, type Live } from "./link.js";
import { yellow } from "./ui.js";

/**
 * A tunnel that fails to open is a warning, and the local server keeps running:
 * it is still worth having.
 *
 * A signal ends the dev session and closes the tunnel before this process
 * exits, so the playground stops routing to a server that is gone. Ctrl-C in a
 * terminal reaches the server as well; a signal sent to this process alone
 * reaches it through `stopChildren`. Either way the server's exit ends the wait,
 * with a three-second limit. A second Ctrl-C exits on the spot.
 */
export async function serve(
	exited: Promise<number>,
	platform: Platform,
	link: LinkPlan | null,
	{ stopChildren }: { stopChildren: () => void },
): Promise<number> {
	if (!link) return exited;
	let live: Live | null = null;
	let signalled = false;
	const shutDown = (code: number) => {
		if (signalled) process.exit(code);
		signalled = true;
		void (live?.stop() ?? Promise.resolve()).then(() => {
			stopChildren();
			setTimeout(() => process.exit(code), 3000).unref();
		});
	};
	process.on("SIGINT", () => shutDown(130));
	process.on("SIGTERM", () => shutDown(143));
	try {
		live = await goLive(platform, link, exited);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(`${yellow("!")} not linked to the platform: ${message}`);
	}
	const code = await exited;
	await live?.stop();
	return code;
}
