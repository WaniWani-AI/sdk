"use client";

import type { UseChatHelpers } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import { getToolName, isToolUIPart } from "ai";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatBaseProps } from "../@types";

type PageToolCallHandler = NonNullable<ChatBaseProps["onToolCall"]>;

type PageToolOutput =
	| { state: "output-available"; output: unknown }
	| { state: "output-error"; errorText: string };

export type PageToolCallsChat = Pick<
	UseChatHelpers<UIMessage>,
	"addToolOutput" | "sendMessage"
>;

const STOPPED_ERROR_TEXT = "Stopped by the user before the page answered.";
const FAILED_ERROR_TEXT = "The page failed to run this tool.";
const UNSTORABLE_ERROR_TEXT = "The page's result could not be stored.";

function errorTextOf(error: unknown): string {
	if (error instanceof Error && error.message) {
		return error.message;
	}
	if (typeof error === "string" && error) {
		return error;
	}
	return FAILED_ERROR_TEXT;
}

// The AI SDK's `onToolCall` also fires for server-run tools, so calls are read once the stream ends;
// `sendMessage()` carries on so the message queue never sees an idle chat in between.

/** Hands the page the tool calls a finished answer left without a result, and carries on once all are answered. */
export function usePageToolCalls(onToolCall: PageToolCallHandler | undefined) {
	const handlerRef = useRef(onToolCall);
	useEffect(() => {
		handlerRef.current = onToolCall;
	}, [onToolCall]);

	const chatRef = useRef<PageToolCallsChat | null>(null);
	// Tool name by tool call id, for every call the page still owes an answer.
	const owedRef = useRef(new Map<string, string>());
	// Answers the page gave that are still being written, by tool call id.
	const writesRef = useRef(new Map<string, Promise<void>>());
	// Bumped by `stop`, `drop` and unmount, so an answer that lands afterwards is ignored.
	const epochRef = useRef(0);
	// The epoch the latest request started in; a finish from an older one hands nothing over.
	const requestEpochRef = useRef(0);
	const stoppingRef = useRef<Promise<boolean> | null>(null);
	const [pending, setPending] = useState(false);

	useEffect(
		() => () => {
			epochRef.current += 1;
			owedRef.current.clear();
		},
		[],
	);

	/** Never rejects: a result the chat cannot store (a function, say) is written as an error. */
	const write = useCallback(
		async (tool: string, toolCallId: string, output: PageToolOutput) => {
			const chat = chatRef.current;
			if (!chat) {
				return;
			}
			try {
				if (output.state === "output-available") {
					// Throws on what the request body can't carry, such as a BigInt or a cycle.
					JSON.stringify(output.output);
					await chat.addToolOutput({
						tool,
						toolCallId,
						state: "output-available",
						output: output.output,
					});
				} else {
					await chat.addToolOutput({
						tool,
						toolCallId,
						state: "output-error",
						errorText: output.errorText,
					});
				}
			} catch {
				try {
					await chat.addToolOutput({
						tool,
						toolCallId,
						state: "output-error",
						errorText: UNSTORABLE_ERROR_TEXT,
					});
				} catch (error) {
					console.warn(
						"[Waniwani] Failed to add the page's tool result:",
						error instanceof Error ? error.message : error,
					);
				}
			}
		},
		[],
	);

	const answer = useCallback(
		async (epoch: number, toolCallId: string, output: PageToolOutput) => {
			const tool = owedRef.current.get(toolCallId);
			if (epoch !== epochRef.current || tool === undefined) {
				return;
			}
			const writing = write(tool, toolCallId, output);
			writesRef.current.set(toolCallId, writing);
			await writing;
			writesRef.current.delete(toolCallId);
			if (epoch !== epochRef.current) {
				return;
			}
			// Removed only once its output is in: `addToolOutput` runs its jobs in
			// order, so the last answer to land here is the last one written.
			owedRef.current.delete(toolCallId);
			if (owedRef.current.size > 0) {
				return;
			}
			setPending(false);
			requestEpochRef.current = epochRef.current;
			void chatRef.current?.sendMessage();
		},
		[write],
	);

	/** Call from `useChat`'s `onFinish`, for an answer that finished cleanly. */
	const handleFinish = useCallback(
		(message: UIMessage) => {
			const handler = handlerRef.current;
			if (!handler || requestEpochRef.current !== epochRef.current) {
				return;
			}
			const calls = message.parts
				.filter(isToolUIPart)
				.filter(
					(part) =>
						part.state === "input-available" &&
						!part.providerExecuted &&
						!owedRef.current.has(part.toolCallId),
				);
			if (calls.length === 0) {
				return;
			}
			const epoch = epochRef.current;
			for (const part of calls) {
				owedRef.current.set(part.toolCallId, getToolName(part));
			}
			setPending(true);
			for (const part of calls) {
				const call = {
					toolCallId: part.toolCallId,
					toolName: getToolName(part),
					input: part.input,
				};
				Promise.resolve()
					.then(() => (epoch === epochRef.current ? handler(call) : undefined))
					.then(
						// JSON has no `undefined`, so a handler that returns nothing answers `null`.
						(output) =>
							answer(epoch, call.toolCallId, {
								state: "output-available",
								output: output === undefined ? null : output,
							}),
						(error: unknown) =>
							answer(epoch, call.toolCallId, {
								state: "output-error",
								errorText: errorTextOf(error),
							}),
					);
			}
		},
		[answer],
	);

	/** Answers every owed call with an error, keeping answers already being written, and stays pending until all are in. */
	const stop = useCallback(
		({ keepBusy = false } = {}): Promise<boolean> => {
			if (stoppingRef.current) {
				return stoppingRef.current;
			}
			if (owedRef.current.size === 0) {
				return Promise.resolve(false);
			}
			epochRef.current += 1;
			const epoch = epochRef.current;
			const owed = [...owedRef.current];
			owedRef.current.clear();
			const stopping = Promise.all(
				owed.map(
					([toolCallId, tool]) =>
						writesRef.current.get(toolCallId) ??
						write(tool, toolCallId, {
							state: "output-error",
							errorText: STOPPED_ERROR_TEXT,
						}),
				),
			).then(() => {
				if (stoppingRef.current === stopping) {
					stoppingRef.current = null;
				}
				if (epoch === epochRef.current && !keepBusy) {
					setPending(false);
				}
				return true;
			});
			stoppingRef.current = stopping;
			return stopping;
		},
		[write],
	);

	/** Forgets every owed call, for when the conversation is replaced. */
	const drop = useCallback(() => {
		epochRef.current += 1;
		owedRef.current.clear();
		stoppingRef.current = null;
		setPending(false);
	}, []);

	/** Call when the user sends a message, so its answer belongs to the current conversation. */
	const markRequest = useCallback(() => {
		requestEpochRef.current = epochRef.current;
	}, []);

	return { chatRef, pending, handleFinish, stop, drop, markRequest };
}
