/** Serves this checkout's built embed against any app deployment, so a PR preview can take beacons before a release. */
import { parseArgs } from "node:util";

const { values } = parseArgs({
	options: {
		app: { type: "string" },
		token: { type: "string" },
		port: { type: "string", default: "4317" },
	},
});

if (!values.app || !values.token) {
	console.error(
		"Usage: bun scripts/agent-beacon-page.ts --app <app origin> --token <wwp_ public key> [--port 4317]",
	);
	process.exit(1);
}

const api = `${new URL(values.app).origin}/api/mcp/chat`;
const bundle = Bun.file(new URL("../dist/chat/embed.js", import.meta.url));

const page = (path: string) => `<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /><title>Agent beacon ${path}</title></head>
<body>
  <h1>Agent beacon test: ${path}</h1>
  <p><a href="/pricing">/pricing</a> · <a href="/docs">/docs</a></p>
  <script src="/embed.js" data-token="${values.token}" data-api="${api}" data-mode="off"></script>
</body>
</html>`;

const server = Bun.serve({
	port: Number(values.port),
	fetch(request) {
		const { pathname } = new URL(request.url);
		if (pathname === "/embed.js") {
			return new Response(bundle, {
				headers: { "Content-Type": "application/javascript" },
			});
		}
		console.log(`${pathname} ${request.headers.get("user-agent") ?? ""}`);
		return new Response(page(pathname), {
			headers: { "Content-Type": "text/html; charset=utf-8" },
		});
	},
});

console.log(`Beacon test page on ${server.url}, reporting to ${api}`);
