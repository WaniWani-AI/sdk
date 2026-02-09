"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useCallback, useRef, useState } from "react";
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
	PromptInputBody,
	PromptInputFooter,
	PromptInputSubmit,
	PromptInputTextarea,
	PromptInputTools,
} from "../ai-elements/prompt-input";
import { mergeTheme, themeToCSSProperties } from "../theme";

export function ChatWidget(props: ChatWidgetProps) {
	const {
		api = "https://app.waniwani.ai/api/chat",
		welcomeMessage,
		title = "Chat",
		subtitle,
		theme: userTheme,
		headers: userHeaders,
		body,
		width = 400,
		height = 600,
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

	return (
		<div
			style={{ ...cssVars, width, height }}
			data-waniwani-chat=""
			className="flex flex-col overflow-hidden rounded-[var(--ww-radius)] border border-border bg-background font-[family-name:var(--ww-font)] text-foreground"
		>
			{/* Header */}
			{(title || subtitle) && (
				<div className="shrink-0 border-b border-border bg-primary px-4 py-3">
					{title && (
						<h2 className="text-[15px] font-semibold text-primary-foreground">
							{title}
						</h2>
					)}
					{subtitle && (
						<p className="text-xs text-primary-foreground/85">{subtitle}</p>
					)}
				</div>
			)}

			{/* Messages */}
			<Conversation className="flex-1">
				<ConversationContent>
					{welcomeMessage && messages.length === 0 && (
						<Message from="assistant">
							<MessageContent>
								<MessageResponse>{welcomeMessage}</MessageResponse>
							</MessageContent>
						</Message>
					)}
					{messages.map((message) => (
						<Message from={message.role} key={message.id}>
							<MessageContent>
								{message.parts.map((part, i) => {
									switch (part.type) {
										case "text":
											return (
												<MessageResponse key={`${message.id}-${i}`}>
													{part.text}
												</MessageResponse>
											);
										default: {
											if (part.type.startsWith("tool-")) {
												const toolPart = part as {
													type: string;
													state: string;
													title?: string;
												};
												const label =
													toolPart.title ?? toolPart.type.replace("tool-", "");
												const isDone =
													toolPart.state === "output-available" ||
													toolPart.state === "output-error" ||
													toolPart.state === "output-denied";
												return (
													<div
														key={`${message.id}-${i}`}
														className="flex items-center gap-1.5 py-1 text-xs italic text-muted-foreground"
													>
														<span>
															{isDone ? `Used ${label}` : `Using ${label}...`}
														</span>
													</div>
												);
											}
											return null;
										}
									}
								})}
							</MessageContent>
						</Message>
					))}
					{(status === "submitted" || status === "streaming") && (
						<Message from="assistant">
							<MessageContent>
								<Loader />
							</MessageContent>
						</Message>
					)}
				</ConversationContent>
				<ConversationScrollButton />
			</Conversation>

			{/* Input */}
			<div className="shrink-0 border-t border-border p-3">
				<PromptInput
					onSubmit={handleSubmit}
					globalDrop={allowAttachments}
					multiple={allowAttachments}
				>
					<PromptInputBody>
						<PromptInputTextarea
							onChange={handleTextChange}
							value={text}
							placeholder="Type a message..."
						/>
					</PromptInputBody>
					<PromptInputFooter>
						<PromptInputTools>
							{allowAttachments && <PromptInputAddAttachments />}
						</PromptInputTools>
						<PromptInputSubmit status={status} />
					</PromptInputFooter>
				</PromptInput>
			</div>
		</div>
	);
}
