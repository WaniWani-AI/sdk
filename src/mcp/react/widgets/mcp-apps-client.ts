import type { McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import { App, PostMessageTransport } from "@modelcontextprotocol/ext-apps";
import type { ModelContextUpdate } from "../../../shared/model-context";
import type {
	DisplayMode,
	SafeArea,
	Theme,
	UnknownObject,
} from "../hooks/@types";
import type {
	ToolCallResult,
	ToolResult,
	UnifiedWidgetClient,
} from "./widget-client";

/**
 * MCP Apps widget client implementation.
 * Uses the @modelcontextprotocol/ext-apps App class for communication.
 */
export class MCPAppsWidgetClient implements UnifiedWidgetClient {
	private app: App;
	private toolResultCallbacks = new Set<(result: ToolResult) => void>();
	private toolResponseMetadataChangeCallbacks = new Set<
		(metadata: UnknownObject | null) => void
	>();
	private themeChangeCallbacks = new Set<(theme: Theme) => void>();
	private displayModeChangeCallbacks = new Set<
		(mode: DisplayMode) => void
	>();
	private hostContext: McpUiHostContext | undefined;
	private latestToolResult: ToolResult | null = null;
	private resizeCleanup: (() => void) | null = null;

	constructor() {
		this.app = new App(
			{ name: "WaniWani Widget", version: "1.0.0" },
			{}, // capabilities
			{ autoResize: false },
		);

		// Set up notification handlers
		this.app.ontoolresult = (params) => {
			const rawParams = params as Record<string, unknown>;
			const underscoreMeta =
				typeof rawParams._meta === "object" && rawParams._meta !== null
					? (rawParams._meta as Record<string, unknown>)
					: null;
			const meta =
				typeof rawParams.meta === "object" && rawParams.meta !== null
					? (rawParams.meta as Record<string, unknown>)
					: null;
			const resolvedMeta = underscoreMeta ?? meta ?? undefined;

			const result: ToolResult = {
				content: params.content,
				structuredContent: params.structuredContent as
					| Record<string, unknown>
					| undefined,
				_meta: resolvedMeta,
				isError:
					typeof rawParams.isError === "boolean"
						? rawParams.isError
						: undefined,
			};
			this.latestToolResult = result;
			for (const cb of this.toolResultCallbacks) cb(result);
			const resultMeta = result._meta ?? null;
			for (const cb of this.toolResponseMetadataChangeCallbacks) cb(resultMeta);
		};

		this.app.onhostcontextchanged = (params) => {
			this.hostContext = { ...this.hostContext, ...params };
			if (params.theme) {
				for (const cb of this.themeChangeCallbacks) cb(params.theme as Theme);
			}
			if (params.displayMode) {
				for (const cb of this.displayModeChangeCallbacks)
					cb(params.displayMode as DisplayMode);
			}
		};
	}

	async connect(): Promise<void> {
		const CONNECTION_TIMEOUT_MS = 10_000;

		const connectPromise = this.app.connect(
			new PostMessageTransport(window.parent, window.parent),
		);

		const timeoutPromise = new Promise<never>((_, reject) => {
			setTimeout(
				() => reject(new Error("Widget connection timed out")),
				CONNECTION_TIMEOUT_MS,
			);
		});

		await Promise.race([connectPromise, timeoutPromise]);
		this.hostContext = this.app.getHostContext();
		this.resizeCleanup = this.setupAutoResize();
	}

	async close(): Promise<void> {
		this.resizeCleanup?.();
		this.resizeCleanup = null;
		await this.app.close();
	}

	/**
	 * Custom auto-resize that uses scrollHeight with a collapsed root element.
	 * The library's built-in autoResize uses fit-content + getBoundingClientRect
	 * which can fail to detect height changes when content grows.
	 */
	private setupAutoResize(): () => void {
		let rafPending = false;
		let lastWidth = 0;
		let lastHeight = 0;

		const measure = () => {
			if (rafPending) {
				return;
			}
			rafPending = true;
			requestAnimationFrame(() => {
				rafPending = false;
				const el = document.documentElement;

				// --- Width: use fit-content (same as library) ---
				const savedWidth = el.style.width;
				el.style.width = "fit-content";
				const fitRect = el.getBoundingClientRect();
				el.style.width = savedWidth;
				const scrollbarGap = window.innerWidth - el.clientWidth;
				const width = Math.ceil(fitRect.width + scrollbarGap);

				// --- Height: read body.scrollHeight + body margins ---
				// We use document.body.scrollHeight rather than collapsing
				// <html> and reading its scrollHeight, because in an iframe
				// document.documentElement.scrollHeight never drops below
				// the viewport height (set by the parent iframe element),
				// causing a ratchet effect where the iframe only ever grows.
				// scrollHeight excludes the body's own margins, so we add
				// them back to avoid clipping.
				const bodyStyle = getComputedStyle(document.body);
				const bodyMargins =
					parseFloat(bodyStyle.marginTop) + parseFloat(bodyStyle.marginBottom);
				const height = Math.ceil(document.body.scrollHeight + bodyMargins);

				if (width !== lastWidth || height !== lastHeight) {
					lastWidth = width;
					lastHeight = height;
					this.app.sendSizeChanged({ width, height });
				}
			});
		};

		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(document.documentElement);
		observer.observe(document.body);
		return () => observer.disconnect();
	}

	getToolOutput<T = Record<string, unknown>>(): T | null {
		// In MCP Apps, tool output comes through ontoolresult notification
		// Return the latest cached result
		if (this.latestToolResult?.structuredContent) {
			return this.latestToolResult.structuredContent as T;
		}
		return null;
	}

	onToolResult(callback: (result: ToolResult) => void): () => void {
		this.toolResultCallbacks.add(callback);
		return () => {
			this.toolResultCallbacks.delete(callback);
		};
	}

	async callTool(
		name: string,
		args: Record<string, unknown>,
	): Promise<ToolCallResult> {
		const result = await this.app.callServerTool({
			name,
			arguments: args,
		});
		return {
			content: result.content,
			structuredContent: result.structuredContent as
				| Record<string, unknown>
				| undefined,
			_meta: result._meta as Record<string, unknown> | undefined,
			isError: typeof result.isError === "boolean" ? result.isError : undefined,
		};
	}

	openExternal(url: string): void {
		this.app.sendOpenLink({ url }).catch((err: unknown) => {
			console.error("Failed to open link:", err);
		});
	}

	sendFollowUp(prompt: string): void {
		this.app
			.sendMessage({
				role: "user",
				content: [{ type: "text", text: prompt }],
			})
			.catch((err: unknown) => {
				console.error("Failed to send follow-up message:", err);
			});
	}

	updateModelContext(context: ModelContextUpdate): Promise<void> {
		return this.app
			.updateModelContext({
				...(context.content ? { content: context.content } : {}),
				...(context.structuredContent
					? { structuredContent: context.structuredContent }
					: {}),
			})
			.then(() => undefined);
	}

	getTheme(): Theme {
		return (this.hostContext?.theme as Theme) ?? "light";
	}

	onThemeChange(callback: (theme: Theme) => void): () => void {
		this.themeChangeCallbacks.add(callback);
		return () => {
			this.themeChangeCallbacks.delete(callback);
		};
	}

	getLocale(): string {
		return (this.hostContext?.locale as string | undefined) ?? "en";
	}

	getDisplayMode(): DisplayMode {
		return (this.hostContext?.displayMode as DisplayMode) ?? "inline";
	}

	async requestDisplayMode(mode: DisplayMode): Promise<DisplayMode> {
		const result = await this.app.requestDisplayMode({ mode });
		return result.mode as DisplayMode;
	}

	onDisplayModeChange(callback: (mode: DisplayMode) => void): () => void {
		this.displayModeChangeCallbacks.add(callback);
		return () => {
			this.displayModeChangeCallbacks.delete(callback);
		};
	}

	// OPENAI specific methods
	getSafeArea(): SafeArea | null {
		return null;
	}

	// MCP Apps specific methods
	onSafeAreaChange(): () => void {
		return () => {};
	}

	// OPENAI specific methods
	getMaxHeight(): number | null {
		return null;
	}

	// MCP Apps specific methods
	onMaxHeightChange(): () => void {
		return () => {};
	}

	// MCP Apps specific methods
	getToolResponseMetadata(): UnknownObject | null {
		return this.latestToolResult?._meta ?? null;
	}

	// MCP Apps specific methods
	onToolResponseMetadataChange(
		callback: (metadata: UnknownObject | null) => void,
	): () => void {
		this.toolResponseMetadataChangeCallbacks.add(callback);
		return () => {
			this.toolResponseMetadataChangeCallbacks.delete(callback);
		};
	}

	// MCP Apps specific methods
	getWidgetState(): UnknownObject | null {
		return null;
	}

	// MCP Apps specific methods
	onWidgetStateChange(): () => void {
		return () => {};
	}
}
