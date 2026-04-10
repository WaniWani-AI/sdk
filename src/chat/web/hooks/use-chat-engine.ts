"use client";

import { useChat } from "@ai-sdk/react";
import type { FileUIPart } from "ai";
import { nanoid } from "nanoid";
import { LenientChatTransport } from "../lib/lenient-chat-transport";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ModelContextUpdate } from "../../../shared/model-context";
import { hasModelContext } from "../../../shared/model-context";
import type { ChatBaseProps } from "../@types";
import type { PromptInputMessage } from "../ai-elements/prompt-input";
import type { VisitorContext } from "../lib/visitor-context";
import { collectVisitorContext } from "../lib/visitor-context";

const SESSION_HEADER_NAME = "x-session-id";

function normalizeSessionId(value: unknown): string | undefined {
	if (typeof value !== "string") {
		return undefined;
	}
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

export interface QueuedMessage {
	id: string;
	text: string;
	files: FileUIPart[];
	modelContext?: ModelContextUpdate;
}

type ChatEngineMessage = PromptInputMessage & {
	modelContext?: ModelContextUpdate;
};

export function useChatEngine(props: ChatBaseProps) {
	const {
		api = "/api/waniwani",
		headers: userHeaders,
		body,
		onMessageSent,
		onResponseReceived,
	} = props;

	const headersRef = useRef(userHeaders);
	const bodyRef = useRef(body);
	const pendingModelContextRef = useRef<ModelContextUpdate | undefined>(
		undefined,
	);
	const visitorContextRef = useRef<VisitorContext | null>(null);
	const [sessionId, setSessionIdState] = useState<string | undefined>(
		undefined,
	);
	const sessionIdRef = useRef<string | undefined>(sessionId);

	const getSessionId = useCallback((): string | undefined => {
		return sessionIdRef.current;
	}, []);

	const setSessionId = useCallback((value: unknown) => {
		const sessionId = normalizeSessionId(value);
		if (!sessionId) {
			return;
		}
		if (sessionIdRef.current === sessionId) {
			return;
		}

		sessionIdRef.current = sessionId;
		setSessionIdState(sessionId);
	}, []);

	const clearSessionId = useCallback(() => {
		sessionIdRef.current = undefined;
		setSessionIdState(undefined);
	}, []);

	useEffect(() => {
		headersRef.current = userHeaders;
	}, [userHeaders]);

	useEffect(() => {
		bodyRef.current = body;
	}, [body]);

	useEffect(() => {
		collectVisitorContext()
			.then((ctx) => {
				visitorContextRef.current = ctx;
			})
			.catch(() => {
				// Best-effort — silently ignore failures
			});
	}, []);

	const transportRef = useRef(
		new LenientChatTransport({
			api,
			headers: () => ({
				...headersRef.current,
			}),
			body: () => {
				const resolvedBody = {
					...(bodyRef.current ?? {}),
				};

				const hasExplicitSessionId = Object.hasOwn(resolvedBody, "sessionId");
				const bodySessionId = normalizeSessionId(resolvedBody.sessionId);
				if (bodySessionId) {
					setSessionId(bodySessionId);
					resolvedBody.sessionId = bodySessionId;
				} else if (hasExplicitSessionId) {
					clearSessionId();
					delete resolvedBody.sessionId;
				} else {
					const storedSessionId = getSessionId();
					if (storedSessionId) {
						resolvedBody.sessionId = storedSessionId;
					}
				}

				if (hasModelContext(pendingModelContextRef.current)) {
					resolvedBody.modelContext = pendingModelContextRef.current;
				}

				if (visitorContextRef.current) {
					const vc = visitorContextRef.current;
					resolvedBody.visitorContext = {
						timezone: vc.timezone,
						language: vc.language,
						languages: vc.languages,
						deviceType: vc.deviceType,
						referrer: vc.referrer,
						visitorId: vc.visitorId,
					};
				}

				return resolvedBody;
			},
			fetch: async (input, init) => {
				const response = await fetch(input, init);
				pendingModelContextRef.current = undefined;
				setSessionId(response.headers.get(SESSION_HEADER_NAME));
				return response;
			},
		}),
	);

	const pendingWaitRef = useRef<{
		resolve: (msg: unknown) => void;
		reject: (err: Error) => void;
	} | null>(null);

	const { messages, sendMessage, setMessages, status } = useChat({
		messages: props.initialMessages,
		transport: transportRef.current,
		onFinish({ message }) {
			onResponseReceived?.();
			if (pendingWaitRef.current) {
				pendingWaitRef.current.resolve(message);
				pendingWaitRef.current = null;
			}
		},
		onError(error) {
			console.warn("[WaniWani] Chat error:", error.message);
			if (pendingWaitRef.current) {
				pendingWaitRef.current.reject(error);
				pendingWaitRef.current = null;
			}
		},
	});

	const [text, setText] = useState("");
	const [queuedMessages, setQueuedMessages] = useState<QueuedMessage[]>([]);

	const isLoading = status === "submitted" || status === "streaming";

	const removeQueuedMessage = useCallback((id: string) => {
		setQueuedMessages((prev) => prev.filter((m) => m.id !== id));
	}, []);

	const queueFull = isLoading && queuedMessages.length > 0;

	const handleSubmit = useCallback(
		(message: ChatEngineMessage) => {
			const hasText = Boolean(message.text?.trim());
			const hasFiles = Boolean(message.files?.length);
			if (!(hasText || hasFiles)) {
				return;
			}

			if (isLoading) {
				// Only allow one queued message at a time
				if (queuedMessages.length > 0) {
					return;
				}

				setQueuedMessages((prev) => [
					...prev,
					{
						id: nanoid(),
						text: message.text || "",
						files: message.files ?? [],
						modelContext: message.modelContext,
					},
				]);
				setText("");
				return;
			}

			pendingModelContextRef.current = message.modelContext;
			sendMessage({
				text: message.text || "",
				files: message.files,
			});

			onMessageSent?.(message.text || "");
			setText("");
		},
		[sendMessage, onMessageSent, isLoading, queuedMessages.length],
	);

	const sendMessageAndWait = useCallback(
		(text: string): Promise<unknown> => {
			return new Promise((resolve, reject) => {
				pendingWaitRef.current = { resolve, reject };
				sendMessage({ text });
				onMessageSent?.(text);
			});
		},
		[sendMessage, onMessageSent],
	);

	// Flush first queued message once the current response finishes
	useEffect(() => {
		if (status !== "ready") {
			return;
		}
		if (queuedMessages.length === 0) {
			return;
		}

		const [first, ...rest] = queuedMessages;
		setQueuedMessages(rest);

		pendingModelContextRef.current = first.modelContext;
		sendMessage({
			text: first.text,
			files: first.files.length > 0 ? first.files : undefined,
		});
		onMessageSent?.(first.text);
	}, [status, sendMessage, onMessageSent, queuedMessages]);

	const reset = useCallback(() => {
		setMessages([]);
		setQueuedMessages([]);
		clearSessionId();
		setText("");
	}, [setMessages, clearSessionId]);

	const handleTextChange = useCallback(
		(e: React.ChangeEvent<HTMLTextAreaElement>) => {
			setText(e.target.value);
		},
		[],
	);

	const lastMessage = messages[messages.length - 1];
	const hasMessages = messages.length > 0;
	const showLoaderBubble =
		isLoading && (!hasMessages || lastMessage.role === "user");

	return {
		messages,
		status,
		text,
		setText,
		handleSubmit,
		handleTextChange,
		isLoading,
		showLoaderBubble,
		lastMessage,
		hasMessages,
		sendMessage,
		sendMessageAndWait,
		reset,
		queuedMessages,
		queueFull,
		removeQueuedMessage,
		sessionId,
	};
}
