import { useEffect, useRef } from "react";
import { ChatMessage } from "./chat-message";

interface MessagePart {
	type: string;
	text?: string;
	[key: string]: unknown;
}

interface Message {
	id: string;
	role: string;
	parts: MessagePart[];
}

interface ChatMessagesProps {
	messages: Message[];
	status: string;
	welcomeMessage?: string;
}

export function ChatMessages(props: ChatMessagesProps) {
	const { messages, status, welcomeMessage } = props;
	const scrollRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (scrollRef.current) {
			scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
		}
	}, []);

	const showTyping = status === "submitted" || status === "streaming";

	return (
		<div
			ref={scrollRef}
			className="ww-scrollbar"
			style={{
				flex: 1,
				overflowY: "auto",
				padding: "16px",
				display: "flex",
				flexDirection: "column",
			}}
		>
			{welcomeMessage && messages.length === 0 && (
				<div
					style={{
						display: "flex",
						justifyContent: "flex-start",
						marginBottom: "8px",
					}}
				>
					<div
						style={{
							maxWidth: "85%",
							padding: "10px 14px",
							borderRadius:
								"var(--ww-msg-radius) var(--ww-msg-radius) var(--ww-msg-radius) 4px",
							backgroundColor: "var(--ww-assistant-bubble)",
							color: "var(--ww-text)",
							fontSize: "14px",
							lineHeight: 1.5,
						}}
					>
						{welcomeMessage}
					</div>
				</div>
			)}

			{messages.map((message) => (
				<ChatMessage key={message.id} message={message} />
			))}

			{showTyping && (
				<div
					style={{
						display: "flex",
						justifyContent: "flex-start",
						marginBottom: "8px",
					}}
				>
					<div
						style={{
							padding: "10px 14px",
							borderRadius:
								"var(--ww-msg-radius) var(--ww-msg-radius) var(--ww-msg-radius) 4px",
							backgroundColor: "var(--ww-assistant-bubble)",
							display: "flex",
							gap: "4px",
							alignItems: "center",
						}}
					>
						<TypingDot delay="0s" />
						<TypingDot delay="0.15s" />
						<TypingDot delay="0.3s" />
					</div>
				</div>
			)}
		</div>
	);
}

function TypingDot(props: { delay: string }) {
	return (
		<span
			style={{
				width: "6px",
				height: "6px",
				borderRadius: "50%",
				backgroundColor: "var(--ww-muted)",
				animation: `ww-bounce 1.2s ease-in-out infinite`,
				animationDelay: props.delay,
			}}
		/>
	);
}
