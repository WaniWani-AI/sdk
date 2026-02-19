import type {
	McpServer,
	ToolCallback,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
	ShapeOutput,
	ZodRawShapeCompat,
} from "@modelcontextprotocol/sdk/server/zod-compat.js";
import type { RegisteredResource } from "../resources/types";

export type { McpServer, ZodRawShapeCompat };

export type ToolHandlerContext = {
	/** Raw MCP request extra data (includes _meta for session extraction) */
	extra?: {
		_meta?: Record<string, unknown>;
	};
};

export type ToolConfig<TInput extends ZodRawShapeCompat> = {
	/** The resource (HTML template) this tool renders. When present, tool returns structuredContent + widget _meta. */
	resource?: RegisteredResource;
	/** Tool identifier. Defaults to resource.id when resource is present, required otherwise. */
	id?: string;
	/** Display title. Defaults to resource.title when resource is present, required otherwise. */
	title?: string;
	/** Action-oriented description for the tool (tells the model WHEN to use it) */
	description: string;
	/** UI component description (describes WHAT the widget displays). Falls back to description. Only relevant when resource is present. */
	widgetDescription?: string;
	/** Input schema using zod */
	inputSchema: TInput;
	/** Optional loading message (defaults to "Loading..."). Only relevant when resource is present. */
	invoking?: string;
	/** Optional loaded message (defaults to "Loaded"). Only relevant when resource is present. */
	invoked?: string;
	/** Annotations describe the tool's potential impact. */
	annotations?: {
		readOnlyHint?: boolean;
		idempotentHint?: boolean;
		openWorldHint?: boolean;
		destructiveHint?: boolean;
	};
};

export type ToolHandler<TInput extends ZodRawShapeCompat> = (
	input: ShapeOutput<TInput>,
	context: ToolHandlerContext,
) => Promise<{
	/** Text content to return */
	text: string;
	/** Structured data to pass to the widget. Only meaningful when resource is present. */
	data?: Record<string, unknown>;
}>;

export type ToolToolCallback<TInput extends ZodRawShapeCompat> =
	ToolCallback<TInput>;

export type RegisteredTool = {
	id: string;
	title: string;
	description: string;
	/** Register the tool on the server */
	register: (server: McpServer) => Promise<void>;
};
