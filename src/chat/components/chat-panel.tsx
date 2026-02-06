import { ChatHeader } from "./chat-header";
import { ChatInput } from "./chat-input";
import { ChatMessages } from "./chat-messages";

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

interface ChatPanelProps {
	messages: Message[];
	input: string;
	onInputChange: (value: string) => void;
	onSend: () => void;
	status: string;
	title: string;
	subtitle?: string;
	welcomeMessage?: string;
	width: number;
	height: number;
}

export function ChatPanel(props: ChatPanelProps) {
	const {
		messages,
		input,
		onInputChange,
		onSend,
		status,
		title,
		subtitle,
		welcomeMessage,
		width,
		height,
	} = props;

	return (
		<div
			className="ww-panel"
			style={{
				width: `${width}px`,
				height: `${height}px`,
				display: "flex",
				flexDirection: "column",
				backgroundColor: "var(--ww-bg)",
				borderRadius: "var(--ww-radius)",
				border: "1px solid var(--ww-border)",
				boxShadow:
					"0 20px 60px -12px rgba(0, 0, 0, 0.15), 0 8px 20px -8px rgba(0, 0, 0, 0.1)",
				overflow: "hidden",
				fontFamily: "var(--ww-font)",
			}}
		>
			<ChatHeader title={title} subtitle={subtitle} />
			<ChatMessages
				messages={messages}
				status={status}
				welcomeMessage={welcomeMessage}
			/>
			<ChatInput
				value={input}
				onChange={onInputChange}
				onSend={onSend}
				disabled={status !== "ready"}
			/>
		</div>
	);
}
