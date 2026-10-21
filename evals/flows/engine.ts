/**
 * The flow engine a run drives: this checkout's `src`, or a published
 * `@waniwani/sdk` version installed once into `evals/.cache/`.
 *
 * A published version brings its own zod and MCP server, resolved from the
 * same install, so the flow's schemas and the server that lists them always
 * come from one place.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createFlow, END, MemoryKvStore, START } from "../../src/mcp";

export type Engine = {
	/** `local`, or the published version, e.g. `0.23.0`. */
	label: string;
	createFlow: typeof createFlow;
	START: typeof START;
	END: typeof END;
	MemoryKvStore: typeof MemoryKvStore;
	z: typeof z;
	McpServer: typeof McpServer;
	InMemoryTransport: typeof InMemoryTransport;
};

const CACHE_DIR = join(import.meta.dir, "..", ".cache");

function installPublished(version: string): string {
	const dir = join(CACHE_DIR, `sdk-${version}`);
	if (existsSync(join(dir, "node_modules", "@waniwani", "sdk"))) {
		return dir;
	}
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		join(dir, "package.json"),
		JSON.stringify({ name: `flow-eval-sdk-${version}`, private: true }),
	);
	console.log(`Installing @waniwani/sdk@${version} into ${dir}`);
	const install = Bun.spawnSync(
		[
			"bun",
			"add",
			`@waniwani/sdk@${version}`,
			"zod@^4",
			"@modelcontextprotocol/sdk@^1",
		],
		{ cwd: dir, stdout: "inherit", stderr: "inherit" },
	);
	if (install.exitCode !== 0) {
		throw new Error(`Could not install @waniwani/sdk@${version}`);
	}
	return dir;
}

async function importFrom<T>(specifier: string, dir: string): Promise<T> {
	return (await import(Bun.resolveSync(specifier, dir))) as T;
}

export async function loadEngine(label: string): Promise<Engine> {
	if (label === "local") {
		return {
			label,
			createFlow,
			START,
			END,
			MemoryKvStore,
			z,
			McpServer,
			InMemoryTransport,
		};
	}

	const dir = installPublished(label);
	const sdk = await importFrom<Engine>("@waniwani/sdk/mcp", dir);
	const zod = await importFrom<{ z: typeof z }>("zod", dir);
	const server = await importFrom<{ McpServer: typeof McpServer }>(
		"@modelcontextprotocol/sdk/server/mcp.js",
		dir,
	);
	const memory = await importFrom<{
		InMemoryTransport: typeof InMemoryTransport;
	}>("@modelcontextprotocol/sdk/inMemory.js", dir);

	return {
		label,
		createFlow: sdk.createFlow,
		START: sdk.START,
		END: sdk.END,
		MemoryKvStore: sdk.MemoryKvStore,
		z: zod.z,
		McpServer: server.McpServer,
		InMemoryTransport: memory.InMemoryTransport,
	};
}
