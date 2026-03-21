import {
	buildMcpAppsResourceMeta,
	buildOpenAIResourceMeta,
	fetchHtml,
	MIME_TYPE_MCP,
	MIME_TYPE_OPENAI,
} from "./meta";
import type { McpServer, RegisteredResource, ResourceConfig } from "./types";

/**
 * Creates a reusable UI resource (HTML template) that can be attached
 * to tools or flow nodes.
 *
 * @example
 * ```ts
 * const pricingUI = createResource({
 *   id: "pricing_table",
 *   title: "Pricing Table",
 *   baseUrl: "https://my-app.com",
 *   htmlPath: "/widgets/pricing",
 *   widgetDomain: "my-app.com",
 * });
 *
 * await pricingUI.register(server);
 * ```
 */
export function createResource(config: ResourceConfig): RegisteredResource {
	const {
		id,
		title,
		description,
		baseUrl,
		htmlPath,
		widgetDomain,
		prefersBorder = true,
		autoHeight = true,
	} = config;

	// Auto-generate CSP from baseUrl if not explicitly provided
	let widgetCSP = config.widgetCSP ?? {
		connect_domains: [baseUrl],
		resource_domains: [baseUrl],
	};

	// In development with localhost, add extra CSP domains for
	// Next.js dev features (WebSocket HMR, Turbopack font serving)
	if (process.env.NODE_ENV === "development") {
		try {
			const { hostname } = new URL(baseUrl);
			if (hostname === "localhost" || hostname === "127.0.0.1") {
				widgetCSP = {
					...widgetCSP,
					connect_domains: [
						...(widgetCSP.connect_domains || []),
						`ws://${hostname}:*`,
						`wss://${hostname}:*`,
					],
					resource_domains: [
						...(widgetCSP.resource_domains || []),
						`http://${hostname}:*`,
					],
				};
			}
		} catch {
			// Invalid baseUrl — skip dev CSP additions
		}
	}

	const openaiUri = `ui://widgets/apps-sdk/${id}.html`;
	const mcpUri = `ui://widgets/ext-apps/${id}.html`;

	// Lazy HTML — fetched once, shared across all calls
	let htmlPromise: Promise<string> | null = null;
	const getHtml = () => {
		if (!htmlPromise) {
			htmlPromise = fetchHtml(baseUrl, htmlPath);
		}
		return htmlPromise;
	};

	// Use description for UI metadata
	const uiDescription = description;

	async function register(server: McpServer): Promise<void> {
		const html = await getHtml();

		// Register OpenAI Apps SDK resource
		server.registerResource(
			`${id}-openai-widget`,
			openaiUri,
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
			mcpUri,
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
							widgetDomain,
							widgetCSP,
						}),
					},
				],
			}),
		);
	}

	return {
		id,
		title,
		description,
		openaiUri,
		mcpUri,
		autoHeight,
		register,
	};
}
