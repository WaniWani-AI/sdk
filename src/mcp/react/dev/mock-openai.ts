import {
	type DisplayMode,
	type OpenAIGlobals,
	SetGlobalsEvent,
	type Theme,
} from "../hooks/@types";

const DEFAULT_MOCK_CONFIG: Omit<OpenAIGlobals, "setWidgetState"> = {
	theme: "dark",
	userAgent: {
		device: { type: "desktop" },
		capabilities: { hover: true, touch: false },
	},
	locale: "en",
	maxHeight: 800,
	displayMode: "inline",
	safeArea: { insets: { top: 0, bottom: 0, left: 0, right: 0 } },
	toolInput: {},
	toolOutput: null,
	toolResponseMetadata: null,
	widgetState: null,
};

let mockState: Omit<OpenAIGlobals, "setWidgetState"> = {
	...DEFAULT_MOCK_CONFIG,
};

export function initializeMockOpenAI(
	initialToolOutput?: Record<string, unknown>,
): void {
	if (typeof window === "undefined") return;
	if (window.openai) return; // Already initialized (real ChatGPT or previous mock)

	mockState = {
		...DEFAULT_MOCK_CONFIG,
		toolOutput: initialToolOutput ?? null,
	};

	window.openai = {
		...mockState,
		// Mock API functions
		requestDisplayMode: async ({ mode }) => {
			updateMockGlobal("displayMode", mode);
			return { mode };
		},
		callTool: async (name, args) => {
			console.log(`[DevMode] callTool: ${name}`, args);
			return { result: JSON.stringify({ mock: true, tool: name, args }) };
		},
		sendFollowUpMessage: async ({ prompt }) => {
			console.log(`[DevMode] sendFollowUpMessage: ${prompt}`);
		},
		openExternal: ({ href }) => {
			console.log(`[DevMode] openExternal: ${href}`);
			window.open(href, "_blank");
		},
		setWidgetState: async (state) => {
			updateMockGlobal("widgetState", state);
		},
	};

	// Dispatch initial event so hooks pick up the values
	window.dispatchEvent(new SetGlobalsEvent({ globals: mockState }));
}

export function updateMockGlobal<K extends keyof OpenAIGlobals>(
	key: K,
	value: OpenAIGlobals[K],
): void {
	if (typeof window === "undefined" || !window.openai) return;

	(mockState as Record<string, unknown>)[key] = value;
	(window.openai as Record<string, unknown>)[key] = value;

	window.dispatchEvent(new SetGlobalsEvent({ globals: { [key]: value } }));
}

export function getMockState(): typeof mockState {
	return { ...mockState };
}

export function updateMockToolOutput(props: Record<string, unknown>): void {
	updateMockGlobal("toolOutput", props);
}

export function updateMockDisplayMode(mode: DisplayMode): void {
	updateMockGlobal("displayMode", mode);
}

export function updateMockTheme(theme: Theme): void {
	updateMockGlobal("theme", theme);
}
