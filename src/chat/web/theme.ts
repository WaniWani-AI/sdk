import type { ChatTheme } from "./@types";

export const DEFAULT_THEME: Required<ChatTheme> = {
	primaryColor: "#6366f1",
	primaryForeground: "#1f2937",
	backgroundColor: "#ffffff",
	textColor: "#1f2937",
	mutedColor: "#6b7280",
	borderColor: "#e5e7eb",
	assistantBubbleColor: "#f3f4f6",
	userBubbleColor: "#f4f4f4",
	inputBackgroundColor: "#f9fafb",
	borderRadius: 16,
	messageBorderRadius: 12,
	fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
	headerBackgroundColor: "#ffffff",
	headerTextColor: "#1f2937",
	statusColor: "#22c55e",
	toolCardColor: "#f4f4f5",
};

export const DARK_THEME: ChatTheme = {
	backgroundColor: "#212121",
	headerBackgroundColor: "#1e1e1e",
	headerTextColor: "#ececec",
	textColor: "#ececec",
	primaryForeground: "#ffffff",
	mutedColor: "#8e8ea0",
	borderColor: "#303030",
	assistantBubbleColor: "#2f2f2f",
	userBubbleColor: "#303030",
	inputBackgroundColor: "#2f2f2f",
	primaryColor: "#6366f1",
	statusColor: "#22c55e",
	toolCardColor: "#262626",
};

const CSS_VAR_MAP: Record<keyof ChatTheme, string[]> = {
	primaryColor: ["--ww-primary", "--ww-color-primary"],
	primaryForeground: ["--ww-primary-fg", "--ww-color-primary-foreground"],
	backgroundColor: ["--ww-bg", "--ww-color-background"],
	textColor: [
		"--ww-text",
		"--ww-color-foreground",
		"--ww-color-accent-foreground",
	],
	mutedColor: ["--ww-muted", "--ww-color-muted-foreground"],
	borderColor: ["--ww-border", "--ww-color-border"],
	assistantBubbleColor: ["--ww-assistant-bubble", "--ww-color-accent"],
	userBubbleColor: ["--ww-user-bubble"],
	inputBackgroundColor: ["--ww-input-bg", "--ww-color-input"],
	borderRadius: ["--ww-radius"],
	messageBorderRadius: ["--ww-msg-radius"],
	fontFamily: ["--ww-font"],
	headerBackgroundColor: ["--ww-header-bg"],
	headerTextColor: ["--ww-header-text"],
	statusColor: ["--ww-status"],
	toolCardColor: ["--ww-tool-card", "--ww-color-tool-card"],
};

export function mergeTheme(userTheme?: ChatTheme): Required<ChatTheme> {
	return { ...DEFAULT_THEME, ...userTheme };
}

export function isDarkTheme(theme: Required<ChatTheme>): boolean {
	const hex = theme.backgroundColor.replace("#", "");
	const r = parseInt(hex.substring(0, 2), 16);
	const g = parseInt(hex.substring(2, 4), 16);
	const b = parseInt(hex.substring(4, 6), 16);
	return (r * 299 + g * 587 + b * 114) / 1000 < 128;
}

export function themeToCSSProperties(
	theme: Required<ChatTheme>,
): Record<string, string> {
	const vars: Record<string, string> = {};
	for (const [key, cssVars] of Object.entries(CSS_VAR_MAP)) {
		const value = theme[key as keyof ChatTheme];
		const resolved = typeof value === "number" ? `${value}px` : String(value);
		for (const cssVar of cssVars) {
			vars[cssVar] = resolved;
		}
	}
	return vars;
}
