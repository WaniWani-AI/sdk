/**
 * Flow protocol — the operating instructions the assistant needs to drive a
 * multi-step flow.
 *
 * These live in the tool's *response*, not in its description. A tool
 * description that prescribes conversation behavior, tool sequencing, required
 * follow-up calls, or policy outcomes is what prompt-injection classifiers
 * look for: ChatGPT's connector consent card raises "Suspicious Instruction"
 * on one, and the user is asked to approve a tool that looks like it is trying
 * to steer the model. From the outside there is no way to tell an honest
 * protocol from an injected one when both arrive in the same field.
 *
 * A tool result is the ordinary place for control flow, and it is not
 * classified that way. So the description carries what the tool *is*, the
 * input schema carries what each argument *means*, and everything about what
 * to do next rides back on the response, scoped to the status that actually
 * came out. The assistant sees less text per turn and only the branch it is
 * standing in.
 */

import type { FlowContent } from "./@types";

/** Shape the response assembler passes in. A subset of `FlowContent`. */
export interface NextStepInput {
	status: FlowContent["status"];
	/** Widget tool to render, when `status` is `widget`. */
	tool?: string;
	/** Whether that widget takes user input before the flow resumes. */
	interactive?: boolean;
	/** Whether this response carries the once-per-conversation `intro`. */
	hasIntro?: boolean;
	/** Whether the response echoes a `sessionId` the caller must pass back. */
	echoSessionId?: boolean;
}

const CORRECTION =
	'To change a field the user already answered ("actually my email is X"), call `action: "reset"` with the corrected `stateUpdates`. The flow restarts with every existing answer preserved and filled steps skipped, and may take a different path if the corrected value affects routing. The question on the table is a `continue`, not a `reset`.';

const INTRO =
	"`intro` opens your next message, ahead of the question, the widget call, and the result. `intro.verbatim` is reproduced word for word — no paraphrase, translation, trimming, expansion, or reformatting. `intro.instructions` is how to write the surrounding prose in your own words. It appears once per conversation and is not repeated from earlier turns.";

function interruptSteps(): string[] {
	return [
		"The flow is paused on the user.",
		"- One question: ask `question`, and return the answer as `stateUpdates` keyed by `field`.",
		"- Several questions: ask every entry of `questions` in a single conversational message, then return all the answers keyed by their own `field`.",
		'- `fieldSchema`, when present, describes the accepted value: match enum `values` exactly, send a number for `type: "number"`.',
		"- `context`, when present, shapes your wording and is not shown to the user.",
		'Resume with `action: "continue"`. Send back what the user actually said, including values they volunteered for other fields — those steps get skipped. Anything they left unanswered stays out and the flow asks again.',
	];
}

function widgetSteps(input: NextStepInput): string[] {
	const tool = input.tool ? `\`${input.tool}\`` : "the tool named in `tool`";
	if (input.interactive) {
		return [
			`Render the widget by calling ${tool} with the \`data\` object as its input.`,
			'The widget takes user input, so the flow waits there. Once the user has responded, resume with `action: "continue"` and their selection in `stateUpdates` under `field`.',
		];
	}
	return [
		`Render the widget by calling ${tool} with the \`data\` object as its input. It is display-only, and it is still a step the user sees, so it happens before the flow moves on.`,
		'Once it is rendered, resume with `action: "continue"`. There is nothing to wait for.',
	];
}

/**
 * Build the `nextStep` line(s) for one response. Returns `undefined` when the
 * status speaks for itself and the schema descriptions already cover it.
 */
export function buildNextStep(input: NextStepInput): string | undefined {
	const parts: string[] = [];

	switch (input.status) {
		case "interrupt":
			parts.push(...interruptSteps(), CORRECTION);
			break;
		case "widget":
			parts.push(...widgetSteps(input), CORRECTION);
			break;
		case "complete":
			parts.push("The flow is finished. Present the result to the user.");
			break;
		case "error":
			parts.push("`error` holds what went wrong.");
			break;
	}

	if (input.echoSessionId && input.status !== "complete") {
		parts.push(
			"`sessionId` comes back on every `continue` and `reset` call for this flow.",
		);
	}

	if (input.hasIntro) {
		parts.unshift(INTRO);
	}

	return parts.length > 0 ? parts.join("\n") : undefined;
}
