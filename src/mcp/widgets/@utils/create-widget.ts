import type { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ShapeOutput } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type {
	ServerNotification,
	ServerRequest,
} from "@modelcontextprotocol/sdk/types.js";
import type { z } from "zod";
import type {
	McpServer,
	RegisteredWidget,
	WidgetConfig,
	WidgetHandler,
} from "./types";

/**
 * MIME types for widget resources.
 * OpenAI Apps SDK uses "text/html+skybridge"
 * MCP Apps uses "text/html;profile=mcp-app"
 */
const MIME_TYPE_OPENAI = "text/html+skybridge";
const MIME_TYPE_MCP = "text/html;profile=mcp-app";

interface WidgetCSP {
	connect_domains?: string[];
	resource_domains?: string[];
	frame_domains?: string[];
	redirect_domains?: string[];
}

interface OpenAIResourceMeta {
	[key: string]: unknown;
	"openai/widgetDescription"?: string;
	"openai/widgetPrefersBorder"?: boolean;
	"openai/widgetDomain"?: string;
	"openai/widgetCSP"?: WidgetCSP;
}

interface McpAppsResourceMeta {
	[key: string]: unknown;
	ui?: {
		csp?: {
			connectDomains?: string[];
			resourceDomains?: string[];
			frameDomains?: string[];
			redirectDomains?: string[];
		};
		domain?: string;
		prefersBorder?: boolean;
	};
}

const fetchHtml = async (baseUrl: string, path: string): Promise<string> => {
	const normalizedBase = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
	const result = await fetch(`${normalizedBase}${path}`);
	return await result.text();
};

/**
 * Build OpenAI-specific resource metadata
 */
function buildOpenAIResourceMeta(config: {
	description?: string;
	prefersBorder?: boolean;
	widgetDomain: string;
	widgetCSP?: WidgetCSP;
}): OpenAIResourceMeta {
	return {
		"openai/widgetDescription": config.description,
		"openai/widgetPrefersBorder": config.prefersBorder,
		"openai/widgetDomain": config.widgetDomain,
		...(config.widgetCSP && { "openai/widgetCSP": config.widgetCSP }),
	};
}

/**
 * Build MCP Apps-specific resource metadata
 * Note: MCP Apps (Claude) doesn't use the domain field in the same way as OpenAI.
 * Claude computes it dynamically at request time in the format: {hash}.claudemcpcontent.com
 */
function buildMcpAppsResourceMeta(config: {
	description?: string;
	prefersBorder?: boolean;
	widgetCSP?: WidgetCSP;
}): McpAppsResourceMeta {
	const csp = config.widgetCSP
		? {
				connectDomains: config.widgetCSP.connect_domains,
				resourceDomains: config.widgetCSP.resource_domains,
				frameDomains: config.widgetCSP.frame_domains,
				redirectDomains: config.widgetCSP.redirect_domains,
			}
		: undefined;

	return {
		ui: {
			...(csp && { csp }),
			...(config.prefersBorder !== undefined && {
				prefersBorder: config.prefersBorder,
			}),
		},
	};
}

/**
 * Build tool metadata that references both OpenAI and MCP widget URIs
 */
function buildToolMeta(config: {
	openaiTemplateUri: string;
	mcpTemplateUri: string;
	invoking: string;
	invoked: string;
}) {
	return {
		// OpenAI metadata
		"openai/outputTemplate": config.openaiTemplateUri,
		"openai/toolInvocation/invoking": config.invoking,
		"openai/toolInvocation/invoked": config.invoked,
		"openai/widgetAccessible": true,
		"openai/resultCanProduceWidget": true,
		// MCP Apps metadata
		ui: {
			resourceUri: config.mcpTemplateUri,
		},
	} as const;
}

/**
 * Creates a widget with minimal boilerplate.
 *
 * @example
 * ```ts
 * const weatherWidget = createWidget({
 *   id: "show_weather",
 *   title: "Show Weather",
 *   description: "Displays weather information for a city",
 *   baseUrl: "https://my-app.com",
 *   htmlPath: "/weather",
 *   inputSchema: {
 *     city: z.string().describe("The city name"),
 *   },
 * }, async ({ city }) => ({
 *   text: `Weather for ${city}`,
 *   data: { city, temperature: 72 },
 * }));
 * ```
 */
export function createWidget<TInput extends z.ZodRawShape>(
	config: WidgetConfig<TInput> & { widgetDomain: string },
	handler: WidgetHandler<TInput>,
): RegisteredWidget {
	const {
		id,
		title,
		description,
		widgetDescription,
		baseUrl,
		htmlPath,
		inputSchema,
		invoking = "Loading...",
		invoked = "Loaded",
		widgetDomain,
		prefersBorder = true,
		widgetCSP,
		annotations,
	} = config;

	// Use widgetDescription for UI metadata, fall back to description
	const uiDescription = widgetDescription ?? description;

	// Create URIs for both platforms
	const openaiTemplateUri = `ui://widgets/apps-sdk/${id}.html`;
	const mcpTemplateUri = `ui://widgets/ext-apps/${id}.html`;

	return {
		id,
		title,
		description,

		async register(server: McpServer): Promise<void> {
			const html = await fetchHtml(baseUrl, htmlPath);

			// Build tool metadata that references both widget URIs
			const toolMeta = buildToolMeta({
				openaiTemplateUri,
				mcpTemplateUri,
				invoking,
				invoked,
			});

			// Register OpenAI Apps SDK resource
			server.registerResource(
				`${id}-openai-widget`,
				openaiTemplateUri,
				{
					title,
					description: uiDescription,
					mimeType: MIME_TYPE_OPENAI,
					_meta: {
						"openai/widgetDescription": uiDescription,
						"openai/widgetPrefersBorder": prefersBorder,
					},
				},
				async (uri) => ({
					contents: [
						{
							uri: uri.href,
							mimeType: MIME_TYPE_OPENAI,
							text: html,
							_meta: buildOpenAIResourceMeta({
								description: uiDescription,
								prefersBorder,
								widgetDomain,
								widgetCSP,
							}),
						},
					],
				}),
			);

			// Register MCP Apps resource
			server.registerResource(
				`${id}-mcp-widget`,
				mcpTemplateUri,
				{
					title,
					description: uiDescription,
					mimeType: MIME_TYPE_MCP,
					_meta: {
						ui: {
							prefersBorder,
						},
					},
				},
				async (uri) => ({
					contents: [
						{
							uri: uri.href,
							mimeType: MIME_TYPE_MCP,
							text: html,
							_meta: buildMcpAppsResourceMeta({
								description: uiDescription,
								prefersBorder,
								widgetCSP,
							}),
						},
					],
				}),
			);

			// Register the tool
			server.registerTool(
				id,
				{
					title,
					description,
					inputSchema,
					annotations,
					_meta: toolMeta,
				},
				(async (args: ShapeOutput<TInput>, extra: unknown) => {
					const requestExtra = extra as RequestHandlerExtra<
						ServerRequest,
						ServerNotification
					>;
					const _meta: Record<string, unknown> = requestExtra._meta ?? {};

					const result = await handler(args, { extra: { _meta } });

					/**
					 * This is a workaround to type the tool callback correctly.
					 *
					 * The types are correct but TS is not able to infer the type correctly.
					 */
					return {
						content: [{ type: "text", text: result.text }],
						structuredContent: result.data,
						_meta: {
							...toolMeta,
							..._meta,
						},
					};
				}) as unknown as ToolCallback<TInput>,
			);
		},
	};
}

/**
 * Registers multiple widgets on the server
 */
export async function registerWidgets(
	server: McpServer,
	widgets: RegisteredWidget[],
): Promise<void> {
	await Promise.all(widgets.map((w) => w.register(server)));
}
