import type { z } from "zod";
import type { FlowConfig } from "./@types";

/** Extract a human-readable label from a Zod schema for the AI protocol */
function describeZodField(schema: z.ZodType): string {
	const desc = schema.description ?? "";
	const def = (
		schema as unknown as {
			_zod: { def: { type: string; entries?: Record<string, string> } };
		}
	)._zod?.def;

	if (def?.type === "enum" && def.entries) {
		const vals = Object.keys(def.entries)
			.map((v) => `"${v}"`)
			.join(" | ");
		return desc ? `${vals} — ${desc}` : vals;
	}

	return desc;
}

export function buildFlowProtocol(config: FlowConfig): string {
	const lines = [
		"",
		"## FLOW EXECUTION PROTOCOL",
		"",
		"This tool implements a multi-step conversational flow. Follow this protocol exactly:",
		"",
		'1. Call with `action: "start"` to begin. If the user\'s message already',
		"   contains answers to likely questions, extract them into `stateUpdates`",
		"   as `{ field: value }` pairs. The engine will auto-skip steps whose",
		"   fields are already filled.",
		"   Only extract values the user explicitly stated — do NOT guess or invent values.",
	];

	if (config.state) {
		const fieldList = Object.entries(config.state)
			.map(([key, schema]) => {
				const info = describeZodField(schema);
				return info ? `\`${key}\` (${info})` : `\`${key}\``;
			})
			.join(", ");
		lines.push(`   Known fields: ${fieldList}.`);
	}

	lines.push(
		"2. The response JSON `status` field tells you what to do next:",
		'   - `"interrupt"`: Pause and ask the user. Two forms:',
		"     a. Single question: `{ question, field, context? }` — ask `question`, store answer in `field`.",
		"     b. Multi-question: `{ questions: [{question, field}, ...], context? }` — ask ALL questions",
		"        in one conversational message, collect all answers.",
		"     `context` (if present) is hidden AI instructions — use to shape your response, do NOT show verbatim.",
		"     Then call again with:",
		'     `action: "continue"`, `flowToken` = the `flowToken` from the response (pass back exactly as received),',
		"     `stateUpdates` = answers keyed by their `field` names, plus any other fields the user mentioned.",
		'   - `"widget"`: The flow wants to show a UI widget. Call the tool named in the `tool`',
		"     field, passing the `data` object as the tool's input.",
		"     If the response includes `interactive: false`, the widget is display-only:",
		"     call the display tool, show the widget, then immediately call THIS flow tool again with",
		'     `action: "continue"` and the same `flowToken`. In that case, do NOT wait for the user',
		"     to click or use the widget, and do NOT ask them to interact with it unless the",
		"     description explicitly says otherwise.",
		"     Otherwise, present the widget result to the user. When the user makes a choice or interacts",
		"     with the widget, call THIS flow tool again with:",
		'     `action: "continue"`, `flowToken` = the `flowToken` from the response,',
		"     `stateUpdates` = `{ [field]: <user's selection> }` plus any other fields the user mentioned.",
		'   - `"complete"`: The flow is done. Present the result to the user.',
		'   - `"error"`: Something went wrong. Show the `error` message.',
		"",
		"3. ALWAYS pass back the `flowToken` string exactly as received — it is an opaque token, do not modify it.",
		"4. Do NOT invent state values. Only use `stateUpdates` for information the user explicitly provided.",
		"5. Include only the fields the user actually answered in `stateUpdates` — do NOT guess missing ones.",
		"   If the user did not answer all pending questions, the engine will re-prompt for the remaining ones.",
		"   If the user mentioned values for other known fields, include those too —",
		"   they will be applied immediately and those steps will be auto-skipped.",
	);

	return lines.join("\n");
}
