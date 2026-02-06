import type React from "react";
import { useCallback, useEffect, useRef } from "react";
import { SendIcon } from "../icons";

interface ChatInputProps {
	value: string;
	onChange: (value: string) => void;
	onSend: () => void;
	disabled: boolean;
}

export function ChatInput(props: ChatInputProps) {
	const { value, onChange, onSend, disabled } = props;
	const textareaRef = useRef<HTMLTextAreaElement>(null);

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
			if (e.key === "Enter" && !e.shiftKey) {
				e.preventDefault();
				if (!disabled && value.trim()) {
					onSend();
				}
			}
		},
		[disabled, value, onSend],
	);

	// Auto-resize textarea
	useEffect(() => {
		const textarea = textareaRef.current;
		if (textarea) {
			textarea.style.height = "auto";
			textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;
		}
	}, []);

	return (
		<div
			style={{
				display: "flex",
				alignItems: "flex-end",
				gap: "8px",
				padding: "12px 16px",
				borderTop: "1px solid var(--ww-border)",
				backgroundColor: "var(--ww-bg)",
			}}
		>
			<textarea
				ref={textareaRef}
				value={value}
				onChange={(e) => onChange(e.target.value)}
				onKeyDown={handleKeyDown}
				disabled={disabled}
				placeholder="Type a message..."
				rows={1}
				style={{
					flex: 1,
					resize: "none",
					border: "1px solid var(--ww-border)",
					borderRadius: "8px",
					padding: "8px 12px",
					fontSize: "14px",
					lineHeight: 1.5,
					fontFamily: "var(--ww-font)",
					backgroundColor: "var(--ww-input-bg)",
					color: "var(--ww-text)",
					outline: "none",
					maxHeight: "120px",
					transition: "border-color 0.15s",
				}}
				onFocus={(e) => {
					e.currentTarget.style.borderColor = "var(--ww-primary)";
				}}
				onBlur={(e) => {
					e.currentTarget.style.borderColor = "var(--ww-border)";
				}}
			/>
			<button
				type="button"
				onClick={onSend}
				disabled={disabled || !value.trim()}
				style={{
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					width: "36px",
					height: "36px",
					borderRadius: "8px",
					border: "none",
					backgroundColor:
						disabled || !value.trim()
							? "var(--ww-border)"
							: "var(--ww-primary)",
					color:
						disabled || !value.trim()
							? "var(--ww-muted)"
							: "var(--ww-primary-fg)",
					cursor: disabled || !value.trim() ? "not-allowed" : "pointer",
					transition: "background-color 0.15s, color 0.15s",
					flexShrink: 0,
				}}
				aria-label="Send message"
			>
				<SendIcon size={18} />
			</button>
		</div>
	);
}
