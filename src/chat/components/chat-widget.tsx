"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatWidgetProps } from "../@types";
import {
	Conversation,
	ConversationContent,
	ConversationScrollButton,
} from "../ai-elements/conversation";
import { Loader } from "../ai-elements/loader";
import {
	Message,
	MessageContent,
	MessageResponse,
} from "../ai-elements/message";
import type { PromptInputMessage } from "../ai-elements/prompt-input";
import {
	PromptInput,
	PromptInputAddAttachments,
	PromptInputSubmit,
	PromptInputTextarea,
} from "../ai-elements/prompt-input";
import { cn } from "../lib/utils";
import { mergeTheme, themeToCSSProperties } from "../theme";

export function ChatWidget(props: ChatWidgetProps) {
	const {
		api = "https://app.waniwani.ai/api/chat",
		welcomeMessage,
		theme: userTheme,
		headers: userHeaders,
		body,
		width = 600,
		expandedHeight = 400,
		allowAttachments = false,
		onMessageSent,
		onResponseReceived,
	} = props;

	const resolvedTheme = mergeTheme(userTheme);
	const cssVars = themeToCSSProperties(resolvedTheme);

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
	});

	const [text, setText] = useState("");
	const [isFocused, setIsFocused] = useState(false);
	const containerRef = useRef<HTMLDivElement>(null);

	const hasMessages = messages.length > 0;
	const isExpanded = isFocused;

	// Close on outside click
	useEffect(() => {
		if (!isFocused) return;
		const handleClickOutside = (e: MouseEvent) => {
			if (
				containerRef.current &&
				!containerRef.current.contains(e.target as Node)
			) {
				setIsFocused(false);
			}
		};
		document.addEventListener("mousedown", handleClickOutside);
		return () => document.removeEventListener("mousedown", handleClickOutside);
	}, [isFocused]);

	const handleSubmit = useCallback(
		(message: PromptInputMessage) => {
			const hasText = Boolean(message.text?.trim());
			const hasFiles = Boolean(message.files?.length);
			if (!(hasText || hasFiles)) return;

			sendMessage({
				text: message.text || "",
				files: message.files,
			});

			onMessageSent?.(message.text || "");
			setText("");
		},
		[sendMessage, onMessageSent],
	);

	const handleTextChange = useCallback(
		(e: React.ChangeEvent<HTMLTextAreaElement>) => {
			setText(e.target.value);
		},
		[],
	);

	const handleFocus = useCallback(() => {
		setIsFocused(true);
	}, []);

	// Determine if loader should show (only when streaming and last message has no text yet)
	const showLoader =
		(status === "submitted" || status === "streaming") &&
		(!hasMessages ||
			messages[messages.length - 1].role === "user" ||
			messages[messages.length - 1].parts.every((p) => p.type !== "text"));

	return (
		<div
			ref={containerRef}
			style={{ ...cssVars, width }}
			data-waniwani-chat=""
			className="flex flex-col font-[family-name:var(--ww-font)] text-foreground"
		>
			{/* Messages panel — fades up on expand */}
			<div
				className={cn(
					"overflow-hidden bg-background/80 backdrop-blur-xl transition-all duration-300 ease-out",
					isExpanded
						? "opacity-100 translate-y-0"
						: "opacity-0 translate-y-2 pointer-events-none max-h-0",
				)}
				style={{
					...(isExpanded ? { maxHeight: expandedHeight } : undefined),
					maskImage:
						"linear-gradient(to bottom, transparent, black 24px, black calc(100% - 16px), transparent), linear-gradient(to right, transparent, black 16px, black calc(100% - 16px), transparent)",
					maskComposite: "intersect",
					WebkitMaskImage:
						"linear-gradient(to bottom, transparent, black 24px, black calc(100% - 16px), transparent), linear-gradient(to right, transparent, black 16px, black calc(100% - 16px), transparent)",
					WebkitMaskComposite: "source-in",
				}}
			>
				<Conversation className="flex-1" style={{ height: expandedHeight }}>
					<ConversationContent>
						{welcomeMessage && !hasMessages && (
							<Message from="assistant">
								<MessageContent>
									<MessageResponse>{welcomeMessage}</MessageResponse>
								</MessageContent>
							</Message>
						)}
						{messages.map((message) => (
							<Message from={message.role} key={message.id}>
								<MessageContent>
									{message.parts
										.filter((part) => part.type === "text")
										.map((part, i) => (
											<MessageResponse key={`${message.id}-${i}`}>
												{part.type === "text" ? part.text : ""}
											</MessageResponse>
										))}
								</MessageContent>
							</Message>
						))}
						{showLoader && (
							<Message from="assistant">
								<MessageContent>
									<Loader />
								</MessageContent>
							</Message>
						)}
					</ConversationContent>
					<ConversationScrollButton />
				</Conversation>
			</div>

			{/* Input bar — always visible */}
			<div className="shrink-0">
				<PromptInput
					onSubmit={handleSubmit}
					globalDrop={allowAttachments}
					multiple={allowAttachments}
					className={cn(
						"rounded-[var(--ww-radius)] shadow-sm transition-all duration-300 ease-out",
					)}
				>
					<div className="flex items-center gap-1 px-3 py-2">
						{allowAttachments && <PromptInputAddAttachments />}
						<PromptInputTextarea
							onChange={handleTextChange}
							value={text}
							placeholder="Type a message..."
							onFocus={handleFocus}
							className="min-h-0 py-1.5 px-2"
						/>
						<PromptInputSubmit status={status} />
					</div>
				</PromptInput>
			</div>
		</div>
	);
}
