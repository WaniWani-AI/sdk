#!/usr/bin/env node
/**
 * Exercise a kit app without a chat client: the MCP surface, the widget
 * resources, and the `api/` endpoints.
 *
 *   node probe.mjs http://localhost:3321
 *   node probe.mjs http://localhost:3321 \
 *     --call faq='{"question":"what is this?"}' \
 *     --endpoint POST:/api/cal/slots='{"timeZone":"Europe/Paris"}' \
 *     --endpoint GET:/api/cal/slots
 *
 * A tool with no `--call` is listed but not called, because most tools want
 * arguments that only the person porting the app knows.
 *
 * `--header 'x-vercel-protection-bypass: ...'` reaches a protected preview.
 */

const args = process.argv.slice(2);
const base = (args.find((arg) => !arg.startsWith("--")) ?? "http://localhost:3000").replace(/\/$/, "");

/** `--flag name=value`, repeatable, value optional. */
function collect(flag) {
	const out = [];
	for (let i = 0; i < args.length; i++) {
		if (args[i] !== `--${flag}`) continue;
		const raw = args[++i] ?? "";
		const split = raw.indexOf("=");
		out.push(split === -1 ? [raw, undefined] : [raw.slice(0, split), raw.slice(split + 1)]);
	}
	return out;
}

const extraHeaders = Object.fromEntries(
	collect("header").map(([name, value]) => {
		const [key, ...rest] = `${name}${value === undefined ? "" : `=${value}`}`.split(":");
		return [key.trim(), rest.join(":").trim()];
	}),
);

const url = `${base}/mcp`;
let sessionId;

async function rpc(method, params) {
	const headers = {
		"Content-Type": "application/json",
		Accept: "application/json, text/event-stream",
		...extraHeaders,
	};
	if (sessionId) headers["Mcp-Session-Id"] = sessionId;

	const response = await fetch(url, {
		method: "POST",
		headers,
		body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
	});

	const header = response.headers.get("mcp-session-id");
	if (header) sessionId = header;

	const body = await response.text();
	// Streamable HTTP answers either a plain JSON body or one SSE `data:` frame.
	const frame = body.split("\n").find((line) => line.startsWith("data: "));
	const raw = frame ? frame.slice(6) : body.trim();
	if (!raw) return null;

	let payload;
	try {
		payload = JSON.parse(raw);
	} catch {
		throw new Error(`${method}: ${response.status} answered ${raw.slice(0, 200)}`);
	}
	if (payload.error) throw new Error(`${method}: ${payload.error.message}`);
	return payload.result;
}

const init = await rpc("initialize", {
	protocolVersion: "2025-06-18",
	capabilities: {},
	clientInfo: { name: "probe", version: "1" },
});

console.log(`server        ${init.serverInfo.name} ${init.serverInfo.version}`);
if (init.serverInfo.version === "0.0.0") {
	console.log(`              ! 0.0.0 — the app's package.json has no version`);
}
console.log(`instructions  ${init.instructions ? `${init.instructions.length} chars` : "none"}`);

const { tools } = await rpc("tools/list", {});
console.log(`\ntools         ${tools.length}`);
for (const tool of tools) {
	const view = tool._meta?.["openai/outputTemplate"] ?? tool._meta?.["ui/resourceUri"];
	console.log(`  ${tool.name.padEnd(22)}${view ? "widget" : ""}`);
	// Claude's Connectors Directory rejects a tool with no annotations title.
	if (!tool.annotations?.title) {
		console.log(`  ${"".padEnd(22)}! no annotations.title`);
	}
}

for (const [name, body] of collect("call")) {
	console.log(`\ncall ${name}`);
	try {
		const result = await rpc("tools/call", {
			name,
			arguments: body ? JSON.parse(body) : {},
		});
		if (result.isError) {
			console.log(`  ERROR ${result.content?.[0]?.text?.slice(0, 300)}`);
			continue;
		}
		const structured = result.structuredContent;
		console.log(`  structured ${structured ? JSON.stringify(structured).slice(0, 300) : "none"}`);
		console.log(`  text       ${(result.content?.[0]?.text ?? "").slice(0, 200)}`);
	} catch (error) {
		console.log(`  ERROR ${error.message}`);
	}
}

const { resources } = await rpc("resources/list", {});
console.log(`\nwidgets       ${resources.length}`);
for (const resource of resources) {
	const read = await rpc("resources/read", { uri: resource.uri });
	const html = read.contents?.[0]?.text ?? "";
	const assets = html.match(/\/assets\/[^"']+/g) ?? [];
	console.log(`  ${resource.name.padEnd(22)}${html.length} bytes → ${assets.join(", ") || "no assets"}`);
	if (assets.length === 0) {
		console.log(`  ${"".padEnd(22)}! the view references no bundle`);
	}
}

const endpoints = collect("endpoint");
if (endpoints.length > 0) {
	console.log(`\nendpoints`);
}
for (const [spec, body] of endpoints) {
	const [method, path] = spec.split(":");
	const response = await fetch(`${base}${path}`, {
		method,
		headers: {
			"Content-Type": "application/json",
			// A widget calls from another origin, so the answer has to carry CORS.
			Origin: "https://chatgpt.com",
			...extraHeaders,
		},
		...(body ? { body } : {}),
	});
	const text = await response.text();
	console.log(
		`  ${method.padEnd(5)} ${path.padEnd(22)} ${response.status} cors=${
			response.headers.get("access-control-allow-origin") ?? "none"
		}${response.headers.get("allow") ? ` allow=${response.headers.get("allow")}` : ""}`,
	);
	console.log(`        ${text.slice(0, 200).replace(/\n/g, " ")}`);
	if (response.status === 404) {
		console.log(`        ! 404 — this file did not become a route`);
	}
}
