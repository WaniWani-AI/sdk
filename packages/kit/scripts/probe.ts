#!/usr/bin/env bun
/**
 * Poke a running MCP server: initialize, list the tools, call one, and read a
 * widget resource. Checks a build end to end without a chat client.
 *
 *   bun scripts/probe.ts http://localhost:3000/mcp
 *
 * Calls the example's tools by name, so it needs a build that serves all of them.
 */

/* biome-ignore-all lint/suspicious/noExplicitAny: live JSON-RPC payloads, see scripts/mcp.ts */

import { createClient } from "./mcp.js";

const url = process.argv[2] ?? "http://localhost:3000/mcp";
const { rpc, initialize } = createClient(url);

const init = await initialize("probe");
console.log(`server   ${init.serverInfo.name} ${init.serverInfo.version}`);
const instructions: string = init.instructions ?? "";
console.log(`overview ${instructions ? `${instructions.split("\n")[0]} …` : "(none)"}`);

const { tools } = await rpc("tools/list", {});
console.log(`\ntools    ${tools.length}`);
for (const tool of tools) {
	const view = tool._meta?.["openai/outputTemplate"] ?? tool._meta?.["ui/resourceUri"];
	console.log(`  ${tool.name.padEnd(20)} ${view ? `→ ${view}` : ""}`);
}

const { resources } = await rpc("resources/list", {});
console.log(`\nwidgets  ${resources.length}`);
for (const resource of resources) {
	console.log(`  ${resource.name.padEnd(20)} ${resource.uri}`);
}

console.log("\ncall     check-eligibility { amount: 249.9 }");
const eligibility = await rpc("tools/call", {
	name: "check-eligibility",
	arguments: { amount: 249.9, country: "FR" },
});
console.log(JSON.stringify(eligibility.structuredContent, null, 2));

console.log("\ncall     select-plan");
const widget = await rpc("tools/call", {
	name: "select-plan",
	arguments: {
		amount: 249.9,
		merchant: "Boulanger",
		plans: eligibility.structuredContent.plans.map((plan: any) => ({
			...plan,
			label: `${plan.instalments}×`,
			tagline: plan.fee === 0 ? "Interest free" : "Small fee",
		})),
	},
});
console.log(`  outputTemplate ${widget._meta?.["openai/outputTemplate"] ?? "(none)"}`);
console.log(`  structured     ${Object.keys(widget.structuredContent ?? {}).join(", ")}`);
console.log(`  text           ${widget.content[0].text.split("\n")[0]}`);

console.log("\ncall     split_payment (flow)");
const flow = await rpc("tools/call", {
	name: "split_payment",
	arguments: { action: "start" },
});
console.log(`  ${flow.content[0].text.split("\n").slice(0, 3).join("\n  ")}`);

const html = await rpc("resources/read", { uri: resources[0].uri });
console.log(`\nresource ${resources[0].uri}`);
console.log(`  ${html.contents[0].text.length} bytes of HTML`);
