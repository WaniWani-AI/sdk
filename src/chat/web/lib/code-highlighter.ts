import { type CodeHighlighterPlugin, code } from "@streamdown/code";

export const codeHighlighter: CodeHighlighterPlugin = {
	...code,
	highlight(options, callback) {
		if (!code.supportsLanguage(options.language)) {
			return null;
		}
		return code.highlight(options, callback);
	},
};
