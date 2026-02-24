"use client";

import { useChat } from "@ai-sdk/react";
import type { FileUIPart } from "ai";
import { DefaultChatTransport } from "ai";
import { nanoid } from "nanoid";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatBaseProps } from "../@types";
import type { PromptInputMessage } from "../ai-elements/prompt-input";

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

	const transportRef = useRef(
		new DefaultChatTransport({
			api,
			headers: {
				...userHeaders,
			},
			body,
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
