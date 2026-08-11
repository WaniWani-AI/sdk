/**
 * Shared fakes for the `withWaniwani` tests. Not a `.test.ts` file, so bun does
 * not collect it as a suite.
 */

import { z } from "zod";
import type { TrackInput } from "../../../../tracking/@types.js";
import type { withWaniwani } from "../index.js";

/**
 * A tracker that records every event instead of sending it.
 *
 * `apiKey` is left unset, which is the no-key path; pass one to exercise the
 * hosted branches (widget tokens, funnel sync).
 */
export function mockClient(apiKey?: string) {
	const tracked: TrackInput[] = [];
	let flushed = 0;
	return {
		client: {
			track: async (event: TrackInput) => {
				tracked.push(event);
				return { eventId: `evt_mock_${tracked.length}` };
			},
			identify: async () => ({ eventId: "evt_mock_identify" }),
			flush: async () => {
				flushed += 1;
			},
			kb: {
				ingest: async () => ({
					ingested: 0,
					errors: [],
					chunksIngested: 0,
					filesProcessed: 0,
				}),
				search: async () => [],
				sources: async () => [],
			},
			_config: {
				apiUrl: "https://test.waniwani.ai",
				apiKey,
				tracking: {
					endpointPath: "/api/mcp/events/v2/batch",
					flushIntervalMs: 1000,
					maxBatchSize: 20,
					maxBufferSize: 1000,
					maxRetries: 3,
					retryBaseDelayMs: 200,
					retryMaxDelayMs: 2000,
					shutdownTimeoutMs: 2000,
				},
			},
		},
		tracked,
		flushCount: () => flushed,
	};
}

export type Handler = (input: unknown, extra: unknown) => Promise<unknown>;
export type ToolConfig = Record<string, unknown>;
export type RegisteredEntry = {
	inputSchema?: unknown;
	handler: Handler;
	_meta?: Record<string, unknown>;
};
export type RegisterToolArgs = [string, ToolConfig, Handler];

/**
 * A server that mirrors the MCP SDK's `_registeredTools` storage
 * (name → `{ inputSchema, handler, _meta }`), including the SDK's
 * normalization of a raw shape into a Zod object on the way in.
 *
 * `configs` keeps the config object each tool was registered with, which is how
 * a test tells "passed through untouched" from "replaced with an augmented
 * copy"; `registered` keeps the raw argument tuples.
 */
export function mockServer() {
	const _registeredTools: Record<string, RegisteredEntry> = {};
	const configs: Record<string, ToolConfig> = {};
	const registered: RegisterToolArgs[] = [];
	const server = {
		_registeredTools,
		registerTool: (...args: unknown[]) => {
			const [name, config, handler] = args as RegisterToolArgs;
			registered.push([name, config, handler]);
			configs[name] = config;
			const raw = config?.inputSchema;
			const inputSchema =
				raw && !(raw instanceof z.ZodType)
					? z.object(raw as z.ZodRawShape)
					: raw;
			_registeredTools[name] = {
				...(inputSchema !== undefined && { inputSchema }),
				handler,
				...(config?._meta ? { _meta: config._meta as ToolConfig } : {}),
			};
		},
	};
	return {
		server: server as Parameters<typeof withWaniwani>[0],
		_registeredTools,
		configs,
		registered,
		registerTool: (name: string, config: ToolConfig, handler: Handler) => {
			(server.registerTool as (n: string, c: ToolConfig, h: Handler) => void)(
				name,
				config,
				handler,
			);
		},
	};
}

/** The shape the MCP SDK would validate a call against, for assertions. */
export function shapeOf(schema: unknown): Record<string, unknown> {
	return (schema as { shape: Record<string, unknown> }).shape;
}
