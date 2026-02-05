import type {
	DisplayMode,
	SafeArea,
	Theme,
	UnknownObject,
} from "../../hooks/@types";
import {
	SET_GLOBALS_EVENT_TYPE,
	type SetGlobalsEvent,
} from "../../hooks/@types";
import type {
	ToolCallResult,
	ToolResult,
	UnifiedWidgetClient,
} from "./widget-client";

type GlobalsKey = keyof SetGlobalsEvent["detail"]["globals"];

/**
 * OpenAI widget client implementation.
 * Uses window.openai global object injected by ChatGPT.
 */
export class OpenAIWidgetClient implements UnifiedWidgetClient {
	private getGlobal<T>(
		key: keyof NonNullable<typeof window.openai>,
		fallback: T,
	): T {
		if (typeof window === "undefined") return fallback;
		return (window.openai?.[key] as T) ?? fallback;
	}

	private onGlobalChange<
		K extends GlobalsKey,
		T = SetGlobalsEvent["detail"]["globals"][K],
	>(
		key: K,
		callback: (value: T) => void,
		transform?: (value: SetGlobalsEvent["detail"]["globals"][K]) => T,
	): () => void {
		if (typeof window === "undefined") return () => {};

		const handler = (event: SetGlobalsEvent) => {
			const value = event.detail.globals[key];
			if (value !== undefined) {
				callback(transform ? transform(value) : (value as T));
			}
		};

		window.addEventListener(SET_GLOBALS_EVENT_TYPE, handler, { passive: true });
		return () => window.removeEventListener(SET_GLOBALS_EVENT_TYPE, handler);
	}

	async connect(): Promise<void> {
		if (typeof window === "undefined" || !("openai" in window)) {
			throw new Error("OpenAI global not found. Are you running in ChatGPT?");
		}
	}

	getToolOutput<T = Record<string, unknown>>(): T | null {
		return this.getGlobal<T | null>("toolOutput", null);
	}

	onToolResult(callback: (result: ToolResult) => void): () => void {
		return this.onGlobalChange("toolOutput", callback, (v) => ({
			structuredContent: v ?? {},
		}));
	}

	async callTool(
		name: string,
		args: Record<string, unknown>,
	): Promise<ToolCallResult> {
		if (typeof window === "undefined" || !window.openai?.callTool) {
			throw new Error("OpenAI callTool not available");
		}
		const response = await window.openai.callTool(name, args);
		return { content: [{ type: "text", text: response.result }] };
	}

	openExternal(url: string): void {
		if (typeof window !== "undefined" && window.openai?.openExternal) {
			window.openai.openExternal({ href: url });
		}
	}

	sendFollowUp(prompt: string): void {
		if (typeof window !== "undefined" && window.openai?.sendFollowUpMessage) {
			window.openai.sendFollowUpMessage({ prompt });
		}
	}

	getTheme(): Theme {
		return this.getGlobal("theme", "light" as Theme);
	}

	onThemeChange(callback: (theme: Theme) => void): () => void {
		return this.onGlobalChange("theme", callback);
	}

	getLocale(): string {
		return this.getGlobal("locale", "en");
	}

	getDisplayMode(): DisplayMode {
		return this.getGlobal("displayMode", "inline" as DisplayMode);
	}

	async requestDisplayMode(mode: DisplayMode): Promise<DisplayMode> {
		if (typeof window === "undefined" || !window.openai?.requestDisplayMode) {
			return "inline";
		}
		const result = await window.openai.requestDisplayMode({ mode });
		return result.mode;
	}

	onDisplayModeChange(callback: (mode: DisplayMode) => void): () => void {
		return this.onGlobalChange("displayMode", callback);
	}

	getSafeArea(): SafeArea | null {
		return this.getGlobal("safeArea", null);
	}

	onSafeAreaChange(callback: (safeArea: SafeArea | null) => void): () => void {
		return this.onGlobalChange("safeArea", callback, (v) => v ?? null);
	}

	getMaxHeight(): number | null {
		return this.getGlobal("maxHeight", null);
	}

	onMaxHeightChange(callback: (maxHeight: number | null) => void): () => void {
		return this.onGlobalChange("maxHeight", callback, (v) => v ?? null);
	}

	getToolResponseMetadata(): UnknownObject | null {
		return this.getGlobal("toolResponseMetadata", null);
	}

	onToolResponseMetadataChange(
		callback: (metadata: UnknownObject | null) => void,
	): () => void {
		return this.onGlobalChange(
			"toolResponseMetadata",
			callback,
			(v) => v ?? null,
		);
	}

	getWidgetState(): UnknownObject | null {
		return this.getGlobal<UnknownObject | null>("widgetState", null);
	}

	onWidgetStateChange(
		callback: (state: UnknownObject | null) => void,
	): () => void {
		return this.onGlobalChange("widgetState", callback, (v) => v ?? null);
	}
}
