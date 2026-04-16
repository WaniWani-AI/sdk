import type { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ShapeOutput } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type {
	ServerNotification,
	ServerRequest,
} from "@modelcontextprotocol/sdk/types.js";
import type { z } from "zod";
import { buildToolMeta } from "../resources/meta";
import { extractScopedClient } from "../scoped-client";
import type {
	McpServer,
	RegisteredTool,
	ToolConfig,
	ToolHandler,
} from "./types";

/**
 * Creates an MCP tool with minimal boilerplate.
 *
 * When `handler()` returns `data`, the tool includes it as MCP `structuredContent`.
 * When `config.resource` is provided, the tool also returns widget metadata.
 *
 * @example
 * ```ts
 * // Widget tool (with resource)
 * const pricingTool = createTool({
 *   resource: pricingUI,
 *   description: "Show pricing comparison",
 *   inputSchema: { postalCode: z.string() },
 * }, async ({ postalCode }) => ({
 *   text: "Pricing loaded",
 *   data: { postalCode, prices: [] },
 * }));
 *
 * // Plain tool (no resource)
 * const searchTool = createTool({
 *   id: "search",
 *   title: "Search",
 *   description: "Search the knowledge base",
 *   inputSchema: { query: z.string() },
 * }, async ({ query }) => ({
 *   text: `Results for "${query}"`,
 * }));
 * ```
 */
export function createTool<TInput extends z.ZodRawShape>(
	config: ToolConfig<TInput>,
	handler: ToolHandler<TInput>,
): RegisteredTool {
	const {
		resource,
		description: rawDescription,
		inputSchema,
		annotations,
		autoInjectResultText = true,
		internal = false,
	} = config;

	const description = internal
		? `[INTERNAL — flow-only tool] Do NOT call this tool directly. Only call it when a flow explicitly instructs you to (e.g. in a "widget" step response). Calling it outside of a flow will produce incorrect results.\n\n${rawDescription}`
		: rawDescription;

	const id = config.id ?? resource?.id;
	const title = config.title ?? resource?.title;

	if (!id) {
		throw new Error(
			"createTool: `id` is required when no resource is provided",
		);
	}
	if (!title) {
		throw new Error(
			"createTool: `title` is required when no resource is provided",
		);
	}

	// Build widget metadata only when resource is present
	const toolMeta = resource
		? buildToolMeta({
				openaiTemplateUri: resource.openaiUri,
				mcpTemplateUri: resource.mcpUri,
				invoking: config.invoking ?? "Loading...",
				invoked: config.invoked ?? "Loaded",
				autoHeight: resource.autoHeight,
			})
		: undefined;

	return {
		id,
		title,
		description,

		async register(server: McpServer): Promise<void> {
			server.registerTool(
				id,
				{
					title,
					description,
					inputSchema,
					annotations,
					...(toolMeta && { _meta: toolMeta }),
				},
				(async (args: ShapeOutput<TInput>, extra: unknown) => {
					const requestExtra = extra as RequestHandlerExtra<
						ServerRequest,
						ServerNotification
					>;
					const _meta: Record<string, unknown> = requestExtra._meta ?? {};
					const waniwani = extractScopedClient(requestExtra);

					const result = await handler(args, { extra: { _meta }, waniwani });

					// Widget tool: return structuredContent + widget metadata
					if (resource && result.data) {
						return {
							content: [{ type: "text", text: result.text }],
							structuredContent: result.data,
							_meta: {
								...toolMeta,
								..._meta,
								...(autoInjectResultText === false
									? { "waniwani/autoInjectResultText": false }
									: {}),
							},
						};
					}

					// Plain tool: return text content, plus structuredContent when provided.
					return {
						content: [{ type: "text" as const, text: result.text }],
						...(result.data ? { structuredContent: result.data } : {}),
						...(autoInjectResultText === false
							? {
									_meta: {
										"waniwani/autoInjectResultText": false,
									},
								}
							: {}),
					};
				}) as unknown as ToolCallback<TInput>,
			);
		},
	};
}

/**
 * Registers multiple tools on the server
 */
export async function registerTools(
	server: McpServer,
	tools: RegisteredTool[],
): Promise<void> {
	await Promise.all(tools.map((t) => t.register(server)));
}
