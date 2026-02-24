"use client";

import { useChat } from "@ai-sdk/react";
import type { FileUIPart } from "ai";
import { DefaultChatTransport } from "ai";
import { nanoid } from "nanoid";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatBaseProps } from "../@types";
import type { PromptInputMessage } from "../ai-elements/prompt-input";

const SESSION_STORAGE_KEY = "waniwani-chat-session-id";
const SESSION_HEADER_NAME = "x-session-id";

function normalizeSessionId(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

function readSessionIdFromStorage(): string | undefined {
	if (typeof window === "undefined") return undefined;

	try {
		return normalizeSessionId(
			window.sessionStorage.getItem(SESSION_STORAGE_KEY),
		);
	} catch {
		return undefined;
	}
}

function writeSessionIdToStorage(sessionId: string): void {
	if (typeof window === "undefined") return;

	try {
		window.sessionStorage.setItem(SESSION_STORAGE_KEY, sessionId);
	} catch {
		// Ignore storage failures (private mode, security policy, etc.)
	}
}

function removeSessionIdFromStorage(): void {
	if (typeof window === "undefined") return;

	try {
		window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
	} catch {
		// Ignore storage failures (private mode, security policy, etc.)
	}
}

export interface QueuedMessage {
	id: string;
	text: string;
	files: FileUIPart[];
}

export function useChatEngine(props: ChatBaseProps) {
	const {
		api = "https://app.waniwani.ai/api/chat",
		headers: userHeaders,
		body,
		onMessageSent,
		onResponseReceived,
	} = props;

	const headersRef = useRef(userHeaders);
	const bodyRef = useRef(body);
	const sessionIdRef = useRef<string | undefined>(undefined);

	const getSessionId = useCallback((): string | undefined => {
		if (sessionIdRef.current) return sessionIdRef.current;

		const storedSessionId = readSessionIdFromStorage();
		if (storedSessionId) sessionIdRef.current = storedSessionId;
		return storedSessionId;
	}, []);

	const setSessionId = useCallback((value: unknown) => {
		const sessionId = normalizeSessionId(value);
		if (!sessionId) return;
		if (sessionIdRef.current === sessionId) return;

		sessionIdRef.current = sessionId;
		writeSessionIdToStorage(sessionId);
	}, []);

	const clearSessionId = useCallback(() => {
		sessionIdRef.current = undefined;
		removeSessionIdFromStorage();
	}, []);

	useEffect(() => {
		headersRef.current = userHeaders;
	}, [userHeaders]);

	useEffect(() => {
		bodyRef.current = body;
	}, [body]);

	const transportRef = useRef(
		new DefaultChatTransport({
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
					return resolvedBody;
				}
				if (hasExplicitSessionId) {
					clearSessionId();
					delete resolvedBody.sessionId;
					return resolvedBody;
				}

				const storedSessionId = getSessionId();
				if (storedSessionId) {
					resolvedBody.sessionId = storedSessionId;
				}

				return resolvedBody;
			},
			fetch: async (input, init) => {
				const response = await fetch(input, init);
				setSessionId(response.headers.get(SESSION_HEADER_NAME));
				return response;
			},
		}),
	);

	const { messages, sendMessage, status } = useChat({
		transport: transportRef.current,
		onFinish() {
			onResponseReceived?.();
		},
		onError(error) {
			console.warn("[WaniWani] Chat error:", error.message);
		},
	});

	const [text, setText] = useState("");
	const [queuedMessages, setQueuedMessages] = useState<QueuedMessage[]>([]);

	const isLoading = status === "submitted" || status === "streaming";

	const removeQueuedMessage = useCallback((id: string) => {
		setQueuedMessages((prev) => prev.filter((m) => m.id !== id));
	}, []);

	const handleSubmit = useCallback(
		(message: PromptInputMessage) => {
			const hasText = Boolean(message.text?.trim());
			const hasFiles = Boolean(message.files?.length);
			if (!(hasText || hasFiles)) return;

			if (isLoading) {
				setQueuedMessages((prev) => [
					...prev,
					{
						id: nanoid(),
						text: message.text || "",
						files: message.files ?? [],
					},
				]);
				setText("");
				return;
			}

			sendMessage({
				text: message.text || "",
				files: message.files,
			});

			onMessageSent?.(message.text || "");
			setText("");
		},
		[sendMessage, onMessageSent, isLoading],
	);

	// Flush first queued message once the current response finishes
	useEffect(() => {
		if (status !== "ready") return;
		setQueuedMessages((prev) => {
			if (prev.length === 0) return prev;
			const [first, ...rest] = prev;

			sendMessage({
				text: first.text,
				files: first.files.length > 0 ? first.files : undefined,
			});
			onMessageSent?.(first.text);

			return rest;
		});
	}, [status, sendMessage, onMessageSent]);

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
		queuedMessages,
		removeQueuedMessage,
	};
}
