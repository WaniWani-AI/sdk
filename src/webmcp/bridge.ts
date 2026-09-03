/**
 * The WebMCP bridge.
 *
 * A browsing agent standing on a page never speaks to the MCP server. It speaks
 * to the page, through `document.modelContext`, and this is what puts the
 * server's tools there. Every `execute()` the agent calls lands on the endpoint
 * below, which stamps attribution server-side and answers.
 *
 * Nothing here discovers its own configuration. The endpoint, both ids, and the
 * widget callback are arguments, because there are two callers with two
 * different ways of knowing them: the chat embed reads them from its remote
 * config, and the standalone loader derives them from its own script tag.
 * Sniffing `document.currentScript` inside a bundle that may be loaded twenty
 * modules deep finds the wrong script or none.
 */

import type {
	WebMcpCallResponse,
	WebMcpContentBlock,
	WebMcpListResponse,
	WebMcpPageContext,
	WebMcpRequest,
	WebMcpTool,
	WebMcpWidgetPayload,
} from "./@types";

/**
 * The slice of the WebMCP browser API this uses.
 *
 * Declared structurally rather than pulled from a types package: the API is
 * still moving (the getter migrated from `Navigator` to `Document` in
 * webmcp#173, which is why both are probed below), and a dependency that
 * disagrees with the browser is worse than four lines here.
 */
type ModelContext = {
	registerTool: (
		descriptor: {
			name: string;
			description: string;
			inputSchema?: Record<string, unknown>;
			annotations?: Record<string, unknown>;
			execute: (
				args: Record<string, unknown>,
				options?: { signal?: AbortSignal },
			) => Promise<{ content: WebMcpContentBlock[] }>;
		},
		options?: { signal?: AbortSignal },
	) => Promise<unknown> | unknown;
};

export type WebMcpBridgeOptions = {
	/** Absolute URL of the server's page-facing tools endpoint. */
	endpoint: string;
	/**
	 * Extra request headers, merged over `content-type`.
	 *
	 * The hosted API authenticates with `Authorization: Bearer <public token>`
	 * here, the same as every other call the embed makes. A self-hosted server
	 * reached directly needs none.
	 */
	headers?: Record<string, string>;
	/**
	 * Tab-scoped id, and the key the flow engine stores its state under.
	 *
	 * Must be stable for the tab and must not outlive it. A value that changes
	 * between calls silently restarts every flow; a value that persists across
	 * days resumes a flow abandoned last week mid-question.
	 */
	sessionId: string;
	/**
	 * The visitor's persistent id, from `shared/visitor-id`.
	 *
	 * Identity rather than state. Sending it is what lets a flow started here
	 * and a conversation continued in the chat bubble belong to one person.
	 */
	visitorId?: string;
	/**
	 * The channel this embed belongs to, from the script tag or `/config`.
	 *
	 * Ingest drops events it cannot attribute to a channel, so a tool call sent
	 * without this produces conversions nobody can see.
	 */
	channelId?: string;
	/**
	 * Called when a tool call resolves to a widget the page should mount.
	 *
	 * Optional, and the surface works without it: everything the visitor needs
	 * is also in the text the agent receives. A page with no host gets a flow
	 * carried in words.
	 */
	onWidget?: (widget: WebMcpWidgetPayload) => void;
	/** Defaults to `console`. */
	logger?: Pick<Console, "error" | "info">;
};

/** Live for as long as the bridge is registered. */
export type WebMcpBridge = {
	/** Tools successfully registered with the browser. */
	readonly tools: WebMcpTool[];
	/** Unregister everything. Idempotent. */
	dispose: () => void;
};

function readModelContext(): ModelContext | null {
	if (typeof document === "undefined" && typeof navigator === "undefined") {
		return null;
	}
	// The getter moved from Navigator to Document (webmcp#173). Probe both.
	const candidate =
		(typeof document !== "undefined"
			? (document as unknown as { modelContext?: unknown }).modelContext
			: undefined) ??
		(typeof navigator !== "undefined"
			? (navigator as unknown as { modelContext?: unknown }).modelContext
			: undefined);

	if (
		candidate &&
		typeof (candidate as ModelContext).registerTool === "function"
	) {
		return candidate as ModelContext;
	}
	return null;
}

/** Whether this browser can host site tools at all. Almost every visit: no. */
export function supportsWebMcp(): boolean {
	return readModelContext() !== null;
}

function pageContext(): WebMcpPageContext {
	return { url: location.href, title: document.title };
}

/**
 * Register the server's tools with the browsing agent.
 *
 * Resolves once registration has been attempted for every advertised tool. A
 * tool the browser refuses is logged and skipped rather than failing the rest,
 * because a partial tool list is a working page and an exception here is a
 * blank one.
 *
 * Returns `null` when the browser has no `modelContext`, which is the common
 * case and not an error.
 */
export async function createWebMcpBridge(
	options: WebMcpBridgeOptions,
): Promise<WebMcpBridge | null> {
	const { endpoint, headers, sessionId, visitorId, channelId, onWidget } =
		options;
	const log = options.logger ?? console;

	const mc = readModelContext();
	if (!mc) {
		return null;
	}

	// Unregistration is aborting this, not a method call.
	const controller = new AbortController();
	const onPageHide = () => controller.abort();
	window.addEventListener("pagehide", onPageHide);

	let disposed = false;
	const dispose = () => {
		if (disposed) {
			return;
		}
		disposed = true;
		window.removeEventListener("pagehide", onPageHide);
		controller.abort();
	};

	/**
	 * Identity and place, attached to every request rather than left to each
	 * call site. Read per call, because a single-page app navigates without
	 * re-registering and `page` would otherwise name whichever URL happened to
	 * be open when the tools were published.
	 */
	function identity() {
		return { sessionId, visitorId, channelId, page: pageContext() };
	}

	async function post<T>(
		request: WebMcpRequest,
		signal?: AbortSignal,
	): Promise<T> {
		const response = await fetch(endpoint, {
			method: "POST",
			headers: { "content-type": "application/json", ...headers },
			body: JSON.stringify(request),
			...(signal ? { signal } : {}),
		});
		if (!response.ok) {
			throw new Error(`webmcp ${request.action} failed: ${response.status}`);
		}
		return (await response.json()) as T;
	}

	let tools: WebMcpTool[] = [];
	try {
		const listed = await post<WebMcpListResponse>({
			...identity(),
			action: "list",
		});
		tools = listed?.tools ?? [];
	} catch (error) {
		log.error("[webmcp] could not list site tools", error);
		dispose();
		return null;
	}

	const registered: WebMcpTool[] = [];
	await Promise.all(
		tools.map(async (tool) => {
			try {
				await mc.registerTool(
					{
						name: tool.name,
						description: tool.description ?? "",
						...(tool.inputSchema ? { inputSchema: tool.inputSchema } : {}),
						...(tool.annotations ? { annotations: tool.annotations } : {}),
						execute: async (args, execOptions) => {
							// The agent's abort travels all the way to the tool, so a
							// visitor who navigates away mid-flow cancels the work
							// upstream instead of leaving it running.
							const result = await post<WebMcpCallResponse>(
								{
									...identity(),
									action: "call",
									name: tool.name,
									arguments: args ?? {},
								},
								execOptions?.signal,
							);
							// A widget step arrives already resolved: the page mounts the
							// view, the agent is told in words that it is on screen.
							// Handed to a callback rather than rendered here so the host
							// owns presentation, and a host with none still works.
							if (result?.widget) {
								onWidget?.(result.widget);
							}
							return { content: result?.content ?? [] };
						},
					},
					{ signal: controller.signal },
				);
				registered.push(tool);
			} catch (error) {
				log.error(`[webmcp] could not register ${tool.name}`, error);
			}
		}),
	);

	log.info(`[webmcp] registered ${registered.length} site tool(s)`);

	return {
		get tools() {
			return registered;
		},
		dispose,
	};
}
