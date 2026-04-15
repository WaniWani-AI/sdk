// Lightweight stub for @streamdown/code in the embed bundle.
// Strips shiki (8MB+ of syntax grammars) — code blocks render as plain <pre>.
export function code() {
	return {};
}
