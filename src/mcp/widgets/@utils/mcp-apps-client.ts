import type { McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import { App, PostMessageTransport } from "@modelcontextprotocol/ext-apps";
import type {
	DisplayMode,
	SafeArea,
	Theme,
	UnknownObject,
} from "../../hooks/@types";
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
	private toolResultCallback: ((result: ToolResult) => void) | null = null;
	private themeChangeCallback: ((theme: Theme) => void) | null = null;
	private displayModeChangeCallback: ((mode: DisplayMode) => void) | null =
		null;
	private hostContext: McpUiHostContext | undefined;
	private latestToolResult: ToolResult | null = null;

	constructor() {
		this.app = new App(
			{ name: "WaniWani Widget", version: "1.0.0" },
			{}, // capabilities
			{ autoResize: true },
		);

		// Set up notification handlers
		this.app.ontoolresult = (params) => {
			const result: ToolResult = {
				content: params.content,
				structuredContent: params.structuredContent as
					| Record<string, unknown>
					| undefined,
			};
			this.latestToolResult = result;
			this.toolResultCallback?.(result);
		};

		this.app.onhostcontextchanged = (params) => {
			this.hostContext = { ...this.hostContext, ...params };
			if (params.theme) {
				this.themeChangeCallback?.(params.theme as Theme);
			}
			if (params.displayMode) {
				this.displayModeChangeCallback?.(params.displayMode as DisplayMode);
			}
		};
	}

	async connect(): Promise<void> {
		await this.app.connect(
			new PostMessageTransport(window.parent, window.parent),
		);
		this.hostContext = this.app.getHostContext();
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
		this.toolResultCallback = callback;
		return () => {
			this.toolResultCallback = null;
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

	getTheme(): Theme {
		return (this.hostContext?.theme as Theme) ?? "light";
	}

	onThemeChange(callback: (theme: Theme) => void): () => void {
		this.themeChangeCallback = callback;
		return () => {
			this.themeChangeCallback = null;
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
		this.displayModeChangeCallback = callback;
		return () => {
			this.displayModeChangeCallback = null;
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
		return null;
	}

	// MCP Apps specific methods
	onToolResponseMetadataChange(): () => void {
		return () => {};
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
