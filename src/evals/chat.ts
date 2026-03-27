import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	parseJsonEventStream,
	readUIMessageStream,
	type UIMessage,
	uiMessageChunkSchema,
} from "ai";
import { z } from "zod";
import type {
	ChatResult,
	ConversationResult,
	ConversationTurn,
	ConversationTurnResult,
	SessionReplay,
	ToolCallTrace,
	TurnAssertion,
} from "./types";

// UIMessage parts are heterogeneous — validate the fields we need, pass extras through
const sessionReplaySchema = z.object({
	name: z.string(),
	mode: z.enum(["regenerate", "inject"]).optional(),
	outcome: z.object({ toolsCalled: z.array(z.string()) }).optional(),
	messages: z.array(
		z.looseObject({
			id: z.string(),
			role: z.enum(["user", "assistant", "system", "data"]),
			parts: z.array(z.record(z.string(), z.unknown())),
		}),
	),
});

// --- Internal helpers ---

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

/** Extract the tool names called in a recorded assistant UIMessage. */
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
		new TransformStream({
			transform(chunk, controller) {
				if (chunk.success) {
					controller.enqueue(chunk.value);
				}
			},
		}),
	);

	let finalMessage: UIMessage | undefined;
	for await (const msg of readUIMessageStream({ stream: chunkStream })) {
		finalMessage = msg;
	}

	if (!finalMessage) {
		throw new Error("No message received from stream");
	}

	return { result: parseUIMessage(finalMessage), message: finalMessage };
}

// --- Public API ---

/**
 * Load all session replay JSON files from a directory.
 * Drop any exported session JSON there — it just works.
 *
 * @param dir - Path to the sessions directory. Defaults to `evals/sessions`.
 */
/**
 * Save a session replay JSON file to the sessions directory.
 *
 * @param session - The session to save.
 * @param dir - Path to the sessions directory. Defaults to `evals/sessions`.
 * @returns The filename that was written.
 */
export function saveSession(
	session: SessionReplay,
	dir = "evals/sessions",
): string {
	const root = join(process.cwd(), dir);
	mkdirSync(root, { recursive: true });
	const filename = `${session.name}.json`;
	writeFileSync(join(root, filename), JSON.stringify(session, null, 2));
	return filename;
}

export function loadSessions(dir = "evals/sessions"): SessionReplay[] {
	const root = join(process.cwd(), dir);
	return readdirSync(root)
		.filter((f) => f.endsWith(".json"))
		.sort()
		.map((f) => {
			const raw = JSON.parse(readFileSync(join(root, f), "utf8"));
			return sessionReplaySchema.parse(raw) as unknown as SessionReplay;
		});
}

/**
 * Send a single user message to a WaniWani MCP chat endpoint.
 */
export async function chat(url: string, message: string): Promise<ChatResult> {
	const userMsg: UIMessage = {
		id: crypto.randomUUID(),
		role: "user",
		parts: [{ type: "text", text: message }],
	};
	const { result } = await sendMessages(url, [userMsg]);
	return result;
}

/**
 * Run a multi-turn conversation. Returns the result of each turn.
 */
export async function conversation(
	url: string,
	turns: ConversationTurn[],
): Promise<ConversationResult> {
	const history: UIMessage[] = [];
	const turnResults: ConversationTurnResult[] = [];

	for (const turn of turns) {
		history.push({
			id: crypto.randomUUID(),
			role: "user",
			parts: [{ type: "text", text: turn.input }],
		});

		const { result, message } = await sendMessages(url, history);
		history.push(message);

		turnResults.push({ input: turn.input, response: result, assertions: [] });
	}

	return { turns: turnResults };
}

/**
 * Replay a recorded conversation session (exported from the chatbar debug button).
 * Uses UIMessage[] directly — same format as useChat's messages array.
 *
 * **"regenerate" mode** (default):
 *   Sends only user messages. The LLM generates fresh responses.
 *   Per-turn assertions are auto-derived by comparing actual tool calls
 *   to the tool calls recorded in the session.
 *
 * **"inject" mode**:
 *   Injects the recorded conversation as-is, only generates a fresh
 *   response for the final user message.
 */
export async function replaySession(
	url: string,
	session: SessionReplay,
): Promise<ConversationResult> {
	const mode = session.mode ?? "regenerate";
	const history: UIMessage[] = [];
	const turnResults: ConversationTurnResult[] = [];

	// Pair user messages with their assistant responses
	const userTurns: { userMsg: UIMessage; assistantMsg?: UIMessage }[] = [];
	for (let i = 0; i < session.messages.length; i++) {
		const msg = session.messages[i];
		if (msg.role === "user") {
			const next = session.messages[i + 1];
			userTurns.push({
				userMsg: msg,
				assistantMsg: next?.role === "assistant" ? next : undefined,
			});
		}
	}

	for (let turnIdx = 0; turnIdx < userTurns.length; turnIdx++) {
		const { userMsg, assistantMsg } = userTurns[turnIdx];
		const isLastTurn = turnIdx === userTurns.length - 1;

		// Extract expected tools from the recorded assistant message
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

/** Compare expected vs. actual tool calls and return assertion results. */
function buildAssertions(
	expected: string[],
	actual: string[],
): TurnAssertion[] {
	if (expected.length === 0) {
		return [];
	}

	// Group expected tools and check each against actual calls
	const actualSet = new Set(actual);
	const expectedUnique = [...new Set(expected)];

	return expectedUnique.map((tool) => ({
		passed: actualSet.has(tool),
		expected: [tool],
		actual,
	}));
}
