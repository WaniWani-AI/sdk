import type { FlowConfig } from "./@types";

export function buildFlowProtocol(config: FlowConfig): string {
	const lines = [
		"",
		"## FLOW EXECUTION PROTOCOL",
		"",
		"This tool implements a multi-step conversational flow. Follow this protocol exactly:",
		"",
		'1. Call with `action: "start"` to begin and include `intent`.',
		"   `intent` must be a brief summary of the user's goal for this flow.",
		"   Do NOT invent missing intent.",
		"   Optionally include `context` — the situation or environment that led the user to start",
		"   this flow (e.g. what page they are on, what they were doing, or what triggered the request).",
		"   Only provide `context` when there is genuinely relevant situational information. Do NOT invent missing context.",
		"   If the user's message already contains answers to likely questions,",
		"   extract them into `stateUpdates` as `{ field: value }` pairs (see the `stateUpdates` schema",
		"   for the list of writable fields). The engine will auto-skip steps whose fields are already filled.",
		"   Only extract values the user explicitly stated — do NOT guess or invent values.",
	];

	if (config.omitIntentPII) {
		lines.push(
			"   Do NOT include PII in `intent` or `context` — no names, emails, phones, addresses, IDs, ages, or birthdates.",
			'   Summarize the goal abstractly (e.g. "user wants a quote", not "Jane Doe wants a quote").',
		);
	}

	lines.push(
		"   For grouped fields (z.object state), use dot-notation keys in `stateUpdates`:",
		'   e.g. `{ "driver.name": "John", "driver.license": "ABC123" }`.',
		"2. The response JSON `status` field tells you what to do next:",
		'   - `"interrupt"`: Pause and ask the user. Two forms:',
		"     a. Single question: `{ question, field, fieldSchema?, context? }` — ask `question`, store answer in `field`.",
		"     b. Multi-question: `{ questions: [{question, field, fieldSchema?}, ...], context? }` — ask ALL questions",
		"        in one conversational message, collect all answers.",
		"     `fieldSchema` (when present) describes the expected value: `{ type, values?, description?, optional? }`.",
		'     Use it to validate before sending — match enum `values` exactly, coerce strings to numbers where `type: "number"`.',
		"     `context` (if present) is hidden AI instructions — use to shape your response, do NOT show verbatim.",
		"     Then call again with:",
		'     `action: "continue"`,',
		"     `stateUpdates` = answers keyed by their `field` names, plus any other fields the user mentioned.",
		'   - `"widget"`: The flow wants to show a UI widget. Call the tool named in the `tool`',
		"     field, passing the `data` object as the tool's input.",
		"     Check the `interactive` field in the response:",
		"     • `interactive: true` — The widget requires user interaction. After calling the display tool,",
		"       STOP and WAIT for the user to interact with the widget. Do NOT call this flow tool again",
		"       until the user has responded. When they do, call with:",
		'       `action: "continue"`,',
		"       `stateUpdates` = `{ [field]: <user's selection> }` plus any other fields the user mentioned.",
		"     • `interactive: false` — The widget is display-only. Call the display tool, then immediately",
		'       call THIS flow tool again with `action: "continue"`. Do NOT wait for user interaction.',
		'   - `"complete"`: The flow is done. Present the result to the user.',
		'   - `"error"`: Something went wrong. Show the `error` message.',
		"",
		"3. Do NOT invent state values. Only use `stateUpdates` for information the user explicitly provided.",
		"4. Include only the fields the user actually answered in `stateUpdates` — do NOT guess missing ones.",
		"   If the user did not answer all pending questions, the engine will re-prompt for the remaining ones.",
		"   If the user mentioned values for other known fields, include those too —",
		"   they will be applied immediately and those steps will be auto-skipped.",
		"5. CORRECTION: If the user wants to CHANGE a previously-answered field",
		'   (e.g. "actually my email is X" or "go back and change my country"),',
		'   call with `action: "reset"` and `stateUpdates` containing the corrected field(s).',
		"   The engine will restart the flow from the beginning with all existing answers preserved",
		"   plus your corrections. Steps with filled answers will be auto-skipped.",
		"   The flow may take a different path if the corrected value affects routing.",
		'   Do NOT use "reset" for the CURRENT question — use "continue" for that.',
		"6. If the response includes a `sessionId`, you MUST pass it back as `sessionId`",
		'   in every subsequent "continue" and "reset" call for this flow.',
	);

	return lines.join("\n");
}
