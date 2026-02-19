import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export type { McpServer };

export type WidgetCSP = {
	/** Domains permitted for fetch/XHR network requests */
	connect_domains?: string[];
	/** Domains for static assets (images, fonts, scripts, styles) */
	resource_domains?: string[];
	/** Origins allowed for iframe embeds (triggers stricter app review) */
	frame_domains?: string[];
	/** Origins that can receive openExternal redirects without safe-link modal */
	redirect_domains?: string[];
};

export type ResourceConfig = {
	/** Unique identifier for the resource */
	id: string;
	/** Display title */
	title: string;
	/** UI description (describes WHAT the resource displays) */
	description?: string;
	/** Base URL for fetching the HTML */
	baseUrl: string;
	/** Path to the HTML file (relative to baseUrl) */
	htmlPath: string;
	/** Domain for OpenAI security context */
	widgetDomain: string;
	/** Whether widget prefers border (defaults to true) */
	prefersBorder?: boolean;
	/** When true, the iframe height auto-adapts to its content */
	autoHeight?: boolean;
	/** Content Security Policy configuration */
	widgetCSP?: WidgetCSP;
};

export type RegisteredResource = {
	readonly id: string;
	readonly title: string;
	readonly description: string | undefined;
	/** OpenAI URI: ui://widgets/apps-sdk/{id}.html */
	readonly openaiUri: string;
	/** MCP URI: ui://widgets/ext-apps/{id}.html */
	readonly mcpUri: string;
	readonly autoHeight: boolean | undefined;
	/** Register this resource on an McpServer */
	register: (server: McpServer) => Promise<void>;
};
