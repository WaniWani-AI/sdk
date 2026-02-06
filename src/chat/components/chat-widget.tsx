"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatWidgetProps } from "../@types";
import { useChatTracking } from "../hooks/use-chat-tracking";
import { buildStyleSheet } from "../styles";
import { mergeTheme, themeToCSSProperties } from "../theme";
import { ChatPanel } from "./chat-panel";

const DEFAULT_API = "https://app.waniwani.ai/api/chat";

export function ChatWidget(
	props: ChatWidgetProps & { _shadowRoot?: ShadowRoot },
) {
	const {
		apiKey,
		api = DEFAULT_API,
		welcomeMessage,
		title = "Chat",
		subtitle,
		theme: userTheme,
		headers: userHeaders,
		body,
		width = 400,
		height = 600,
		onMessageSent,
		onResponseReceived,
		_shadowRoot,
	} = props;

	const resolvedTheme = mergeTheme(userTheme);
	const cssVars = themeToCSSProperties(resolvedTheme);

	const { trackChatOpened, trackMessageSent, trackResponseReceived } =
		useChatTracking({ apiKey });

	const transportRef = useRef(
		new DefaultChatTransport({
			api,
			headers: {
				...userHeaders,
				...(apiKey ? { "x-waniwani-api-key": apiKey } : {}),
			},
			body,
		}),
	);

	const { messages, sendMessage, status } = useChat({
		transport: transportRef.current,
		onFinish() {
			trackResponseReceived();
			onResponseReceived?.();
		},
	});

	const [input, setInput] = useState("");

	const handleSend = useCallback(() => {
		if (!input.trim()) return;
		sendMessage({ text: input });
		trackMessageSent();
		onMessageSent?.(input);
		setInput("");
	}, [input, sendMessage, trackMessageSent, onMessageSent]);

	// Inject stylesheet into shadow root for embed mode
	const styleInjected = useRef(false);
	useEffect(() => {
		if (_shadowRoot && !styleInjected.current) {
			styleInjected.current = true;
			const style = document.createElement("style");
			style.textContent = buildStyleSheet();
			_shadowRoot.appendChild(style);
		}
	}, [_shadowRoot]);

	// Track chat opened on mount
	const tracked = useRef(false);
	useEffect(() => {
		if (!tracked.current) {
			tracked.current = true;
			trackChatOpened();
		}
	}, [trackChatOpened]);

	return (
		<div style={cssVars} data-waniwani-chat="">
			<ChatPanel
				messages={messages}
				input={input}
				onInputChange={setInput}
				onSend={handleSend}
				status={status}
				title={title}
				subtitle={subtitle}
				welcomeMessage={welcomeMessage}
				width={width}
				height={height}
			/>
		</div>
	);
}
