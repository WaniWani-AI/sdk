/**
 * The shapes crossing the WebMCP boundary.
 *
 * Structural rather than imported from `@modelcontextprotocol/sdk`, because
 * everything here is also read by the browser bridge, and the MCP SDK is an
 * optional peer dependency that has no business in a page bundle. What the
 * server sends and what the page reads is JSON either way.
 */

/**
 * One MCP content block. `type` is the discriminator every block carries; the
 * index signature keeps the rest of whichever block it is, since nothing on
 * this path reads them and re-deriving the union would only restate a schema
 * the server already validated on the way out.
 */
export type WebMcpContentBlock = {
	type: string;
	text?: string;
	[key: string]: unknown;
};

/** A tool as `tools/list` describes it. */
export type WebMcpTool = {
	name: string;
	description?: string;
	inputSchema?: Record<string, unknown>;
	annotations?: Record<string, unknown>;
	_meta?: Record<string, unknown>;
};

/** A tool result as `tools/call` returns it. */
export type WebMcpCallResult = {
	content?: WebMcpContentBlock[];
	structuredContent?: Record<string, unknown>;
	isError?: boolean;
	_meta?: Record<string, unknown>;
};

/**
 * Everything the page needs to mount a widget itself.
 *
 * Assembled server-side because none of it is derivable on the page: the view
 * URI carries a content hash that moves every deploy, and the display tool's
 * result is what the view reads its own configuration from.
 */
export type WebMcpWidgetPayload = {
	/**
	 * The `ui://` the view was resolved from.
	 *
	 * Carries a content hash that moves on every deploy, which is why this is
	 * resolved server-side per call and why nothing on the page can cache it.
	 *
	 * The only half of the view the page is told. Where to fetch it from is the
	 * resource endpoint the page already derived from its token, the same one
	 * the chat's own widget iframes use.
	 */
	viewUri: string;
	/** Display tool the view belongs to. */
	tool: string;
	/** Props, delivered to the view as `ui/notifications/tool-input`. */
	data: Record<string, unknown>;
	/** The display tool's own result, delivered as `ui/notifications/tool-result`. */
	result: {
		content: WebMcpContentBlock[];
		structuredContent?: Record<string, unknown>;
		_meta?: Record<string, unknown>;
	};
	/** Whether the flow is waiting on the visitor before it can advance. */
	interactive: boolean;
	/**
	 * Set by the preview endpoint. A real widget step is a flow waiting on the
	 * visitor and has no way out; a preview is something someone opened to look
	 * at, so the host can give it one.
	 */
	preview?: boolean;
};

/** What every page-facing request carries, whatever it is asking for. */
type WebMcpRequestBase = {
	/**
	 * Tab-scoped, and the key the flow engine stores its state under.
	 *
	 * Must be stable for the tab and must not outlive it. A value that changes
	 * between calls silently restarts every flow; one that persists across days
	 * resumes a flow abandoned last week mid-question.
	 */
	sessionId: string;
	/**
	 * The visitor's persistent id. Identity rather than state, and what lets a
	 * flow started here and a conversation continued in the chat bubble belong
	 * to one person.
	 */
	visitorId?: string;
	/**
	 * The channel this page's embed belongs to.
	 *
	 * Sent because ingest rejects events it cannot attribute to a channel, and a
	 * token-only embed learns its channel from `/config` rather than from its
	 * own markup. Without it a tool call is attributed to nothing and the events
	 * behind it are dropped.
	 */
	channelId?: string;
	/** Where the visitor was standing when the agent called. */
	page?: WebMcpPageContext;
};

/**
 * `POST` body for the page-facing tools endpoint.
 *
 * The bridge builds exactly this, so a server implementing the other end is
 * type-checked against what actually arrives rather than against a description
 * of it.
 */
export type WebMcpRequest =
	| (WebMcpRequestBase & { action: "list" })
	| (WebMcpRequestBase & {
			action: "call";
			name: string;
			arguments?: Record<string, unknown>;
	  });

/** Where the visitor was standing when the agent called. */
export type WebMcpPageContext = {
	url?: string;
	title?: string;
};

export type WebMcpListResponse = {
	tools: WebMcpTool[];
};

export type WebMcpCallResponse = {
	content: WebMcpContentBlock[];
	structuredContent?: Record<string, unknown>;
	isError?: boolean;
	/** Present and non-null only when the call produced a resolvable widget step. */
	widget: WebMcpWidgetPayload | null;
};
