// Lightweight stub for @streamdown/code in the embed bundle.
// Strips shiki (8MB+ of syntax grammars) — code blocks render as plain <pre>.
export const code = {
	name: "shiki-noop",
	type: "code-highlighter",
	supportsLanguage: () => false,
	getSupportedLanguages: () => [],
	getThemes: () => ["github-light", "github-dark"],
	highlight: () => null,
};

export function createCodePlugin() {
	return code;
}
