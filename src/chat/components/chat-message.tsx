import { ToolIcon } from "../icons";
import { ChatMarkdown } from "./chat-markdown";

interface MessagePart {
	type: string;
	text?: string;
	toolName?: string;
	state?: string;
	[key: string]: unknown;
}

interface Message {
	id: string;
	role: string;
	parts: MessagePart[];
}

export function ChatMessage(props: { message: Message }) {
	const { message } = props;
	const isUser = message.role === "user";

	return (
		<div
			style={{
				display: "flex",
				justifyContent: isUser ? "flex-end" : "flex-start",
				marginBottom: "8px",
				animation: "ww-fade-in 0.2s ease-out",
			}}
		>
			<div
				style={{
					maxWidth: "85%",
					padding: "10px 14px",
					borderRadius: isUser
						? "var(--ww-msg-radius) var(--ww-msg-radius) 4px var(--ww-msg-radius)"
						: "var(--ww-msg-radius) var(--ww-msg-radius) var(--ww-msg-radius) 4px",
					backgroundColor: isUser
						? "var(--ww-user-bubble)"
						: "var(--ww-assistant-bubble)",
					color: isUser ? "var(--ww-primary-fg)" : "var(--ww-text)",
					fontSize: "14px",
					lineHeight: 1.5,
					wordBreak: "break-word",
				}}
			>
				{message.parts.map((part, i) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: message parts are append-only
					<MessagePartRenderer key={i} part={part} isUser={isUser} />
				))}
			</div>
		</div>
	);
}

function MessagePartRenderer(props: { part: MessagePart; isUser: boolean }) {
	const { part, isUser } = props;

	if (part.type === "text" && part.text) {
		return isUser ? (
			<span>{part.text}</span>
		) : (
			<ChatMarkdown text={part.text} />
		);
	}

	if (part.type.startsWith("tool-") || part.type === "tool-invocation") {
		const toolName = part.toolName ?? part.type.replace("tool-", "");
		const isLoading =
			part.state === "input-streaming" || part.state === "input-available";

		return (
			<div
				style={{
					display: "flex",
					alignItems: "center",
					gap: "6px",
					padding: "4px 0",
					fontSize: "12px",
					color: "var(--ww-muted)",
					fontStyle: "italic",
				}}
			>
				<ToolIcon size={12} />
				<span>{isLoading ? `Using ${toolName}...` : `Used ${toolName}`}</span>
				{isLoading && (
					<span style={{ animation: "ww-pulse 1.5s ease-in-out infinite" }}>
						...
					</span>
				)}
			</div>
		);
	}

	return null;
}
