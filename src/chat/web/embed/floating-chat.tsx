// ============================================================================
// FloatingChat — bubble + slide-up panel for the embeddable chat widget
// ============================================================================

import {
	forwardRef,
	useCallback,
	useEffect,
	useImperativeHandle,
	useRef,
	useState,
} from "react";
import type { ChatHandle, ChatTheme } from "../@types";
import { ChatCard } from "../layouts/chat-card";
import type { EmbedConfig } from "./config";

function buildChatTheme(config: EmbedConfig): ChatTheme | undefined {
	if (!config.theme) {
		return undefined;
	}
	const t = config.theme;
	return {
		...(t.primaryColor ? { primaryColor: t.primaryColor } : {}),
		...(t.backgroundColor ? { backgroundColor: t.backgroundColor } : {}),
		...(t.textColor ? { textColor: t.textColor } : {}),
		...(t.fontFamily ? { fontFamily: t.fontFamily } : {}),
	};
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FloatingChatProps {
	config: EmbedConfig;
}

export interface FloatingChatHandle {
	open: () => void;
	close: () => void;
	toggle: () => void;
	chat: ChatHandle | null;
}

// ---------------------------------------------------------------------------
// Inline SVG icons (avoids bundling lucide-react)
// ---------------------------------------------------------------------------

function ChatIcon() {
	return (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			width="24"
			height="24"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			role="img"
			aria-label="Chat"
		>
			<title>Chat</title>
			<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
		</svg>
	);
}

function CloseIcon() {
	return (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			width="18"
			height="18"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			role="img"
			aria-label="Close"
		>
			<title>Close</title>
			<line x1="18" y1="6" x2="6" y2="18" />
			<line x1="6" y1="6" x2="18" y2="18" />
		</svg>
	);
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BUBBLE_SIZE = 56;
const BUBBLE_MARGIN = 20;
const PANEL_GAP = 12;
const TRANSITION_MS = 200;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const FloatingChat = forwardRef<FloatingChatHandle, FloatingChatProps>(
	function FloatingChat({ config }, ref) {
		const [isOpen, setIsOpen] = useState(false);
		const [lastSeenCount, setLastSeenCount] = useState(0);
		const [isMobile, setIsMobile] = useState(false);
		const chatRef = useRef<ChatHandle>(null);

		// -----------------------------------------------------------------------
		// Mobile detection
		// -----------------------------------------------------------------------
		useEffect(() => {
			const mql = window.matchMedia("(max-width: 768px)");
			const handler = (e: MediaQueryListEvent | MediaQueryList) =>
				setIsMobile(e.matches);
			handler(mql);
			mql.addEventListener(
				"change",
				handler as (e: MediaQueryListEvent) => void,
			);
			return () =>
				mql.removeEventListener(
					"change",
					handler as (e: MediaQueryListEvent) => void,
				);
		}, []);

		// -----------------------------------------------------------------------
		// Escape key
		// -----------------------------------------------------------------------
		useEffect(() => {
			if (!isOpen) {
				return;
			}
			const handler = (e: KeyboardEvent) => {
				if (e.key === "Escape") {
					setIsOpen(false);
				}
			};
			document.addEventListener("keydown", handler);
			return () => document.removeEventListener("keydown", handler);
		}, [isOpen]);

		// -----------------------------------------------------------------------
		// Track last-seen count for unread dot
		// -----------------------------------------------------------------------
		useEffect(() => {
			if (isOpen) {
				setLastSeenCount(chatRef.current?.messages.length ?? 0);
			}
		}, [isOpen]);

		// -----------------------------------------------------------------------
		// Imperative handle
		// -----------------------------------------------------------------------
		const open = useCallback(() => setIsOpen(true), []);
		const close = useCallback(() => setIsOpen(false), []);
		const toggle = useCallback(() => setIsOpen((v) => !v), []);

		useImperativeHandle(ref, () => ({
			open,
			close,
			toggle,
			get chat() {
				return chatRef.current;
			},
		}));

		// -----------------------------------------------------------------------
		// Unread indicator
		// -----------------------------------------------------------------------
		const currentCount = chatRef.current?.messages.length ?? 0;
		const hasUnread = !isOpen && currentCount > lastSeenCount;

		// -----------------------------------------------------------------------
		// Position helpers
		// -----------------------------------------------------------------------
		const isLeft = config.position === "bottom-left";
		const panelWidth = config.width ?? 400;
		const panelHeight = config.height ?? 600;
		const primaryColor = config.theme?.primaryColor ?? "#6366f1";

		// -----------------------------------------------------------------------
		// Styles
		// -----------------------------------------------------------------------

		const wrapperStyle: React.CSSProperties = {
			position: "fixed",
			bottom: BUBBLE_MARGIN,
			...(isLeft ? { left: BUBBLE_MARGIN } : { right: BUBBLE_MARGIN }),
			zIndex: 2147483647, // max z-index to sit above everything
			fontFamily:
				config.theme?.fontFamily ??
				"system-ui, -apple-system, 'Segoe UI', sans-serif",
		};

		const bubbleStyle: React.CSSProperties = {
			width: BUBBLE_SIZE,
			height: BUBBLE_SIZE,
			borderRadius: "50%",
			backgroundColor: primaryColor,
			color: "#ffffff",
			border: "none",
			cursor: "pointer",
			display: "flex",
			alignItems: "center",
			justifyContent: "center",
			boxShadow: "0 4px 12px rgba(0, 0, 0, 0.15)",
			transition: `transform ${TRANSITION_MS}ms ease, box-shadow ${TRANSITION_MS}ms ease`,
			outline: "none",
		};

		const panelContainerStyle: React.CSSProperties = isMobile
			? {
					// Full-screen on mobile
					position: "fixed",
					inset: 0,
					zIndex: 2147483647,
					transition: `transform ${TRANSITION_MS}ms ease, opacity ${TRANSITION_MS}ms ease`,
					...(isOpen
						? {
								transform: "translateY(0) scale(1)",
								opacity: 1,
							}
						: {
								transform: "translateY(20px) scale(0.95)",
								opacity: 0,
								pointerEvents: "none" as const,
							}),
				}
			: {
					position: "absolute",
					bottom: BUBBLE_SIZE + PANEL_GAP,
					...(isLeft ? { left: 0 } : { right: 0 }),
					width: panelWidth,
					height: panelHeight,
					transition: `transform ${TRANSITION_MS}ms ease, opacity ${TRANSITION_MS}ms ease`,
					...(isOpen
						? {
								transform: "translateY(0) scale(1)",
								opacity: 1,
							}
						: {
								transform: "translateY(20px) scale(0.95)",
								opacity: 0,
								pointerEvents: "none" as const,
							}),
				};

		const panelInnerStyle: React.CSSProperties = {
			width: "100%",
			height: "100%",
			borderRadius: isMobile ? 0 : 12,
			overflow: "hidden",
			boxShadow: isMobile
				? "none"
				: "0 8px 32px rgba(0, 0, 0, 0.12), 0 2px 8px rgba(0, 0, 0, 0.08)",
		};

		const closeButtonStyle: React.CSSProperties = {
			position: "absolute",
			top: isMobile ? 12 : 8,
			right: isMobile ? 12 : 8,
			zIndex: 10,
			width: isMobile ? 36 : 28,
			height: isMobile ? 36 : 28,
			borderRadius: "50%",
			backgroundColor: "rgba(0, 0, 0, 0.06)",
			border: "none",
			cursor: "pointer",
			display: "flex",
			alignItems: "center",
			justifyContent: "center",
			color: "inherit",
			outline: "none",
			transition: `background-color ${TRANSITION_MS}ms ease`,
		};

		const unreadDotStyle: React.CSSProperties = {
			position: "absolute",
			top: -2,
			right: -2,
			width: 12,
			height: 12,
			borderRadius: "50%",
			backgroundColor: "#ef4444",
			border: "2px solid #ffffff",
		};

		// -----------------------------------------------------------------------
		// Build ChatCard theme from embed config
		// -----------------------------------------------------------------------
		const chatTheme = buildChatTheme(config);

		return (
			<div style={wrapperStyle}>
				{/* Panel */}
				<div style={panelContainerStyle} role="dialog" aria-label="Chat panel">
					<div style={{ ...panelInnerStyle, position: "relative" }}>
						{/* Close button overlaid on ChatCard header */}
						<button
							type="button"
							onClick={close}
							style={closeButtonStyle}
							aria-label="Close chat"
							onMouseEnter={(e) => {
								(e.currentTarget as HTMLButtonElement).style.backgroundColor =
									"rgba(0, 0, 0, 0.12)";
							}}
							onMouseLeave={(e) => {
								(e.currentTarget as HTMLButtonElement).style.backgroundColor =
									"rgba(0, 0, 0, 0.06)";
							}}
						>
							<CloseIcon />
						</button>

						<ChatCard
							ref={chatRef}
							api={config.api}
							headers={{ Authorization: `Bearer ${config.token}` }}
							theme={chatTheme}
							title={config.title ?? "Assistant"}
							welcomeMessage={config.welcomeMessage}
							placeholder={config.placeholder}
							suggestions={
								config.suggestions ? { initial: config.suggestions } : undefined
							}
							width="100%"
							height="100%"
						/>
					</div>
				</div>

				{/* Bubble */}
				<button
					type="button"
					onClick={toggle}
					style={{ ...bubbleStyle, position: "relative" }}
					aria-label={isOpen ? "Close chat" : "Open chat"}
					onMouseEnter={(e) => {
						(e.currentTarget as HTMLButtonElement).style.transform =
							"scale(1.08)";
						(e.currentTarget as HTMLButtonElement).style.boxShadow =
							"0 6px 20px rgba(0, 0, 0, 0.2)";
					}}
					onMouseLeave={(e) => {
						(e.currentTarget as HTMLButtonElement).style.transform = "scale(1)";
						(e.currentTarget as HTMLButtonElement).style.boxShadow =
							"0 4px 12px rgba(0, 0, 0, 0.15)";
					}}
				>
					<ChatIcon />
					{hasUnread && <span style={unreadDotStyle} />}
				</button>
			</div>
		);
	},
);
