import type { ChatTheme } from "./@types";

export const DEFAULT_THEME: Required<ChatTheme> = {
	primaryColor: "#6366f1",
	primaryForeground: "#ffffff",
	backgroundColor: "#ffffff",
	textColor: "#1f2937",
	mutedColor: "#6b7280",
	borderColor: "#e5e7eb",
	assistantBubbleColor: "#f3f4f6",
	userBubbleColor: "#6366f1",
	inputBackgroundColor: "#f9fafb",
	borderRadius: 16,
	messageBorderRadius: 12,
	fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
};

const CSS_VAR_MAP: Record<keyof ChatTheme, string[]> = {
	primaryColor: ["--ww-primary", "--color-primary"],
	primaryForeground: ["--ww-primary-fg", "--color-primary-foreground"],
	backgroundColor: ["--ww-bg", "--color-background"],
	textColor: ["--ww-text", "--color-foreground", "--color-accent-foreground"],
	mutedColor: ["--ww-muted", "--color-muted-foreground"],
	borderColor: ["--ww-border", "--color-border"],
	assistantBubbleColor: ["--ww-assistant-bubble", "--color-accent"],
	userBubbleColor: ["--ww-user-bubble"],
	inputBackgroundColor: ["--ww-input-bg", "--color-input"],
	borderRadius: ["--ww-radius", "--radius"],
	messageBorderRadius: ["--ww-msg-radius"],
	fontFamily: ["--ww-font"],
};

export function mergeTheme(userTheme?: ChatTheme): Required<ChatTheme> {
	return { ...DEFAULT_THEME, ...userTheme };
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
