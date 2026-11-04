import {
	parseJsonEventStream,
	readUIMessageStream,
	type UIMessage,
	type UIMessageChunk,
	uiMessageChunkSchema,
} from "ai";
import type {
	ChatResult,
	ConversationResult,
	ConversationTurnResult,
	EvalScenario,
	ToolCallTrace,
	TurnAssertion,
} from "./types";

function parseUIMessage(msg: UIMessage): ChatResult {
	const output = msg.parts
		.filter((p): p is { type: "text"; text: string } => p.type === "text")
		.map((p) => p.text)
		.join("");

	const toolParts = msg.parts
		.filter((p) => p.type.startsWith("tool-") || p.type === "dynamic-tool")
		.map(
			(p) =>
				p as unknown as {
					toolName: string;
					input?: Record<string, unknown>;
					output?: unknown;
				},
		);
	const toolsCalled = toolParts.map((p) => p.toolName);
	const toolCallTraces: ToolCallTrace[] = toolParts.map((p) => ({
		name: p.toolName,
		input: p.input ?? {},
		output: p.output,
	}));

	return { output, toolsCalled, toolCallTraces };
}

function textFromUIMessage(msg: UIMessage): string {
	return msg.parts
		.filter((p): p is { type: "text"; text: string } => p.type === "text")
		.map((p) => p.text)
		.join("");
}

function extractRecordedTools(msg: UIMessage): string[] {
	return msg.parts
		.filter((p) => p.type === "dynamic-tool" || p.type.startsWith("tool-"))
		.map((p) => (p as unknown as { toolName: string }).toolName)
		.filter(Boolean);
}

async function sendMessages(
	url: string,
	messages: UIMessage[],
): Promise<{ result: ChatResult; message: UIMessage }> {
	const response = await fetch(`${url}/api/waniwani`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		signal: AbortSignal.timeout(60_000),
		body: JSON.stringify({ messages }),
	});

	if (!response.ok) {
		throw new Error(
			`Chat returned ${response.status}: ${await response.text()}`,
		);
	}

	if (!response.body) {
		throw new Error("Chat response has no body");
	}

	const chunkStream = parseJsonEventStream({
		stream: response.body,
		schema: uiMessageChunkSchema,
	}).pipeThrough(
		new TransformStream<
			{ success: boolean; value?: UIMessageChunk },
			UIMessageChunk
		>({
			transform(part, controller) {
				if (part.success && part.value) {
					controller.enqueue(part.value);
				}
			},
		}),
	);

	let finalMessage: UIMessage | undefined;
	for await (const message of readUIMessageStream({ stream: chunkStream })) {
		finalMessage = message;
	}

	if (!finalMessage) {
		throw new Error("Chat stream produced no message");
	}

	return { result: parseUIMessage(finalMessage), message: finalMessage };
}

function buildAssertions(
	expected: string[],
	actual: string[],
): TurnAssertion[] {
	if (expected.length === 0) {
		return [];
	}

	const actualSet = new Set(actual);
	const expectedUnique = [...new Set(expected)];

	return expectedUnique.map((tool) => ({
		passed: actualSet.has(tool),
		expected: [tool],
		actual,
	}));
}

export async function replayScenario(
	url: string,
	scenario: EvalScenario,
): Promise<ConversationResult> {
	const mode = scenario.mode ?? "regenerate";
	const history: UIMessage[] = [];
	const turnResults: ConversationTurnResult[] = [];

	const userTurns: { userMsg: UIMessage; assistantMsg?: UIMessage }[] = [];
	for (let i = 0; i < scenario.messages.length; i++) {
		const msg = scenario.messages[i];
		if (msg.role === "user") {
			const next = scenario.messages[i + 1];
			userTurns.push({
				userMsg: msg,
				assistantMsg: next?.role === "assistant" ? next : undefined,
			});
		}
	}

	for (let turnIdx = 0; turnIdx < userTurns.length; turnIdx++) {
		const { userMsg, assistantMsg } = userTurns[turnIdx];
		const isLastTurn = turnIdx === userTurns.length - 1;

		const expectedTools = assistantMsg
			? extractRecordedTools(assistantMsg)
			: [];

		history.push(userMsg);

		if (mode === "inject" && !isLastTurn && assistantMsg) {
			history.push(assistantMsg);
			const response = parseUIMessage(assistantMsg);
			const assertions = buildAssertions(expectedTools, response.toolsCalled);
			turnResults.push({
				input: textFromUIMessage(userMsg),
				response,
				assertions,
			});
			continue;
		}

		const { result, message } = await sendMessages(url, history);
		history.push(message);

		const assertions = buildAssertions(expectedTools, result.toolsCalled);
		turnResults.push({
			input: textFromUIMessage(userMsg),
			response: result,
			assertions,
		});
	}

	return { turns: turnResults };
}
