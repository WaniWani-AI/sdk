import type { FlowContent } from "./@types";

function singleQuestionCheck(field: string, sessionIdPhrase: string): string {
	return `BEFORE asking, re-read the user's opening message. If it already answers the question below, do NOT ask it: immediately call this tool again with action "continue"${sessionIdPhrase} and stateUpdates: { "${field}": <the answer in the user's own words> }, then follow the new response instead. Do NOT infer or convert values (a life event is not an age); a plain greeting answers nothing. Ask the question below only if their message does not answer it.`;
}

const MULTI_QUESTION_CHECK =
	'BEFORE asking, re-read the user\'s opening message. If it answers any of the questions below, do NOT re-ask those: immediately call this tool again with action "continue" and stateUpdates containing those answers; the engine re-asks the rest. Do NOT infer or convert values. Ask only what their message does not answer.';

/**
 * Appends a hidden instruction to a start-interrupt telling the agent to
 * advance with "continue" when the opening message already answers the
 * parked question. Never persisted, so an empty bounce cannot loop.
 */
export function withStartSelfHeal(
	content: FlowContent,
	options: { sessionIdEchoed: boolean },
): FlowContent {
	if (content.status !== "interrupt") {
		return content;
	}
	if (content.context?.startsWith("ERROR:")) {
		return content;
	}
	const sessionIdPhrase = options.sessionIdEchoed ? ", the same sessionId" : "";
	const check =
		typeof content.field === "string"
			? singleQuestionCheck(content.field, sessionIdPhrase)
			: MULTI_QUESTION_CHECK;
	return {
		...content,
		context: content.context ? `${content.context}\n\n${check}` : check,
	};
}
