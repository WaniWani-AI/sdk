import type { WidgetCSP } from "./types";

/**
 * MIME types for widget resources.
 * OpenAI Apps SDK uses "text/html+skybridge"
 * MCP Apps uses "text/html;profile=mcp-app"
 */
export const MIME_TYPE_OPENAI = "text/html+skybridge";
export const MIME_TYPE_MCP = "text/html;profile=mcp-app";

// ---- HTML fetching ----

export const fetchHtml = async (
	baseUrl: string,
	path: string,
): Promise<string> => {
	const normalizedBase = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
	const result = await fetch(`${normalizedBase}${path}`);
	return await result.text();
};

// ---- OpenAI resource metadata ----

interface OpenAIResourceMeta {
	[key: string]: unknown;
	"openai/widgetDescription"?: string;
	"openai/widgetPrefersBorder"?: boolean;
	"openai/widgetDomain"?: string;
	"openai/widgetCSP"?: WidgetCSP;
}

export function buildOpenAIResourceMeta(config: {
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

// ---- MCP Apps resource metadata ----

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

export function buildMcpAppsResourceMeta(config: {
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

// ---- Tool metadata (references resource URIs) ----

export function buildToolMeta(config: {
	openaiTemplateUri: string;
	mcpTemplateUri: string;
	invoking: string;
	invoked: string;
	autoHeight?: boolean;
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
			...(config.autoHeight && { autoHeight: true }),
		},
	} as const;
}
