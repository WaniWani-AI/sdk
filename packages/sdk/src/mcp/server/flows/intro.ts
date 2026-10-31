/**
 * Flow intro — the first thing the assistant says when a session first
 * touches the flow.
 *
 * A flow can be entered at any node: when the user's opening message already
 * answers the first questions, the engine skips those steps and the
 * conversation starts mid-flow. So the intro is not tied to a node. It is
 * seeded into the session's internal state at `start` and rides along with
 * whatever response the engine returns first, which delivers the introduction
 * and any legal notice exactly once, wherever the flow happens to land,
 * without costing an extra conversation turn.
 *
 * This file only normalizes what the author declared. Where it lives and when
 * it goes out is `internal-state.ts` and the response assembler in
 * `compile.ts`.
 */

import type { FlowIntro, FlowIntroPayload } from "./@types";

/**
 * Normalize an author-supplied `intro` into the payload shape sent on the wire.
 * Called once at compile time so a malformed intro fails at startup rather
 * than on a live conversation.
 *
 * Returns `undefined` when the flow declares no intro.
 */
export function normalizeIntro(
	intro: FlowIntro | undefined,
	flowId: string,
): FlowIntroPayload | undefined {
	if (intro === undefined) {
		return undefined;
	}

	if (typeof intro === "string") {
		const verbatim = intro.trim();
		if (!verbatim) {
			throw new Error(
				`[waniwani] createFlow "${flowId}": \`intro\` is an empty string. ` +
					`Pass the text to deliver word for word, or drop the option.`,
			);
		}
		return { verbatim };
	}

	if (typeof intro !== "object" || intro === null) {
		throw new Error(
			`[waniwani] createFlow "${flowId}": \`intro\` must be a string (delivered verbatim) ` +
				`or an object with \`verbatim\` and/or \`instructions\`.`,
		);
	}

	const verbatim =
		typeof intro.verbatim === "string" ? intro.verbatim.trim() : undefined;
	const instructions =
		typeof intro.instructions === "string"
			? intro.instructions.trim()
			: undefined;

	if (!verbatim && !instructions) {
		throw new Error(
			`[waniwani] createFlow "${flowId}": \`intro\` needs \`verbatim\` (text delivered ` +
				`word for word), \`instructions\` (guidance the assistant writes from), or both.`,
		);
	}

	return {
		...(verbatim ? { verbatim } : {}),
		...(instructions ? { instructions } : {}),
	};
}
