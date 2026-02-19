import type { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ShapeOutput } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type {
	ServerNotification,
	ServerRequest,
} from "@modelcontextprotocol/sdk/types.js";
import type { z } from "zod";
import { buildToolMeta } from "../resources/meta";
import type {
	McpServer,
	RegisteredTool,
	ToolConfig,
	ToolHandler,
} from "./types";

/**
 * Creates an MCP tool with minimal boilerplate.
 *
 * When `config.resource` is provided, the tool returns `structuredContent` + widget metadata.
 * Without a resource, the tool returns plain text content.
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
	const { resource, description, inputSchema, annotations } = config;

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

					const result = await handler(args, { extra: { _meta } });

					// Widget tool: return structuredContent + widget metadata
					if (resource && result.data) {
						return {
							content: [{ type: "text", text: result.text }],
							structuredContent: result.data,
							_meta: {
								...toolMeta,
								..._meta,
							},
						};
					}

					// Plain tool: return text content only
					return {
						content: [{ type: "text" as const, text: result.text }],
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
