import type {
	McpServer,
	ToolCallback,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
	ShapeOutput,
	ZodRawShapeCompat,
} from "@modelcontextprotocol/sdk/server/zod-compat.js";
export type { McpServer, ZodRawShapeCompat };

/**
 * Context passed to widget handlers
 */
export type WidgetHandlerContext = {
	/** Raw MCP request extra data (includes _meta for session extraction) */
	extra?: {
		_meta?: Record<string, unknown>;
	};
};

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

export type WidgetConfig<TInput extends ZodRawShapeCompat> = {
	/** Unique identifier for the widget/tool */
	id: string;
	/** Display title */
	title: string;
	/** Action-oriented description for the tool (tells the model WHEN to use it) */
	description: string;
	/** UI component description (describes WHAT the widget displays). Falls back to description if not provided. */
	widgetDescription?: string;
	/** Base URL for fetching widget HTML */
	baseUrl: string;
	/** Path to fetch HTML from (relative to baseUrl) */
	htmlPath: string;
	/** Input schema using zod */
	inputSchema: TInput;
	/** Optional loading message (defaults to "Loading...") */
	invoking?: string;
	/** Optional loaded message (defaults to "Loaded") */
	invoked?: string;
	/** Optional widget domain for security context */
	widgetDomain?: string;
	/** Optional: whether widget prefers border (defaults to true) */
	prefersBorder?: boolean;
	/** Optional: when true, the iframe height auto-adapts to its content instead of using a fixed height */
	autoHeight?: boolean;
	/** Content Security Policy configuration (required for app submission) */
	widgetCSP?: WidgetCSP;
	/** Optional: Annotations describe the tool’s potential impact. ChatGPT uses these hints to classify tools and decide when to ask the user for confirmation (elicitation) before using the tool.
	 *
	 * Note: openWorldHint and destructiveHint are only considered for writes (i.e. when readOnlyHint=false).
	 */
	annotations?: {
		/** Optional: Set to true for tools that do not change state (search, lookups, previews). This won't require elicitation. */
		readOnlyHint?: boolean;
		/** Optional: Set to true for tools where calling multiple times with the same args has no additional effect. */
		idempotentHint?: boolean;
		/** Optional: Set to false for tools that only affect a bounded target (for example, "update a task by id" in your own product). Leave true for tools that can write to arbitrary URLs/files/resources. */
		openWorldHint?: boolean;
		/** Optional:  Set to true for tools that can delete, overwrite, or have irreversible side effects. */
		destructiveHint?: boolean;
	};
};

export type WidgetHandler<TInput extends ZodRawShapeCompat> = (
	input: ShapeOutput<TInput>,
	context: WidgetHandlerContext,
) => Promise<{
	/** Text content to return */
	text: string;
	/** Structured data to pass to the widget */
	data: Record<string, unknown>;
}>;

export type WidgetToolCallback<TInput extends ZodRawShapeCompat> =
	ToolCallback<TInput>;

export type RegisteredWidget = {
	id: string;
	title: string;
	description: string;
	register: (server: McpServer) => Promise<void>;
};
