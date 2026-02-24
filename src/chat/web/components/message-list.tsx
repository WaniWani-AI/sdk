"use client";

import type { ChatStatus, ReasoningUIPart, ToolUIPart, UIMessage } from "ai";

import { Attachments } from "../ai-elements/attachments";
import { Loader } from "../ai-elements/loader";
import {
	Message,
	MessageContent,
	MessageResponse,
} from "../ai-elements/message";
import { Reasoning } from "../ai-elements/reasoning";
import {
	getAutoHeight,
	getResourceUri,
	Tool,
	ToolContent,
	ToolHeader,
	ToolInput,
	ToolOutput,
} from "../ai-elements/tool";
import type { McpAppDisplayMode } from "./mcp-app-frame";
import { McpAppFrame } from "./mcp-app-frame";
import { WidgetErrorBoundary } from "./widget-error-boundary";

/** Converts `get_price_estimate` or `compare-prices` → `Get price estimate` / `Compare prices` */
function formatToolName(name: string): string {
	return name.replace(/[-_]/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

export interface FullscreenWidget {
	toolCallId: string;
	resourceUri: string;
	toolInput: Record<string, unknown>;
	toolResult: {
		content?: Array<{ type: string; text?: string }>;
		structuredContent?: Record<string, unknown>;
	};
	autoHeight: boolean;
}

interface MessageListProps {
	messages: UIMessage[];
	status: ChatStatus;
	welcomeMessage?: string;
	resourceEndpoint?: string;
	isDark?: boolean;
	onFollowUp?: (message: {
		role: string;
		content: Array<{ type: string; text?: string }>;
	}) => void;
	onWidgetDisplayModeChange?: (
		mode: McpAppDisplayMode,
		widget: FullscreenWidget,
	) => void;
	/** When set, only the matching widget is shown (fullscreen mode). The iframe stays mounted. */
	fullscreenToolCallId?: string | null;
}

export function MessageList({
	messages,
	status,
	welcomeMessage,
	resourceEndpoint,
	isDark,
	onFollowUp,
	onWidgetDisplayModeChange,
	fullscreenToolCallId,
}: MessageListProps) {
	const isLoading = status === "submitted" || status === "streaming";
	const lastMessage = messages[messages.length - 1];
	const hasMessages = messages.length > 0;
	const showLoaderBubble =
		isLoading && (!hasMessages || lastMessage.role === "user");

	return (
		<>
			{welcomeMessage && !fullscreenToolCallId && (
				<Message from="assistant">
					<MessageContent>
						<MessageResponse>{welcomeMessage}</MessageResponse>
					</MessageContent>
				</Message>
			)}
			{messages.map((message) => {
				const textParts = message.parts.filter((p) => p.type === "text");
				const reasoningParts = message.parts.filter(
					(p): p is ReasoningUIPart => p.type === "reasoning",
				);
				const fileParts = message.parts.filter((p) => p.type === "file");
				const toolParts = message.parts.filter(
					(
						p,
					): p is typeof p & {
						toolCallId: string;
						toolName: string;
						state: ToolUIPart["state"];
						input: unknown;
						title?: string;
					} => "toolCallId" in p,
				);
				const isLastAssistant =
					message === lastMessage && message.role === "assistant";
				const hasTextContent = textParts.length > 0;

				// Skip messages that don't contain the fullscreen widget
				const hasFullscreenWidget =
					fullscreenToolCallId &&
					toolParts.some((p) => p.toolCallId === fullscreenToolCallId);
				if (fullscreenToolCallId && !hasFullscreenWidget) return null;

				return (
					<Message from={message.role} key={message.id}>
						{/* Hide reasoning when a widget is fullscreen */}
						{reasoningParts.map((part, i) => (
							<div
								key={`reasoning-${message.id}-${i}`}
								style={fullscreenToolCallId ? { display: "none" } : undefined}
							>
								<Reasoning text={part.text} />
							</div>
						))}
						{toolParts.map((part) => {
							const output = "output" in part ? part.output : undefined;
							const resourceUri =
								output !== undefined ? getResourceUri(output) : undefined;
							const autoHeight =
								output !== undefined ? getAutoHeight(output) : false;
							const isFullscreen = part.toolCallId === fullscreenToolCallId;
							const isHidden = fullscreenToolCallId != null && !isFullscreen;

							return (
								<div
									key={part.toolCallId}
									style={
										isHidden
											? { display: "none" }
											: isFullscreen
												? { height: "100%" }
												: undefined
									}
								>
									{/* Keep Tool in tree but hide when fullscreen (preserves child positions) */}
									<div style={isFullscreen ? { display: "none" } : undefined}>
										<Tool defaultOpen={part.state === "output-available"}>
											<ToolHeader
												title={part.title ?? formatToolName(part.toolName)}
												state={part.state}
											/>
											<ToolContent>
												<ToolInput input={part.input} />
												{output !== undefined && (
													<ToolOutput
														output={output}
														errorText={
															"errorText" in part ? part.errorText : undefined
														}
													/>
												)}
											</ToolContent>
										</Tool>
									</div>
									{resourceUri && output !== undefined && (
										<WidgetErrorBoundary>
											<McpAppFrame
												resourceUri={resourceUri}
												toolInput={
													(part.input as Record<string, unknown>) ?? {}
												}
												toolResult={{
													content: (output as Record<string, unknown>)
														.content as
														| Array<{
																type: string;
																text?: string;
														  }>
														| undefined,
													structuredContent: (output as Record<string, unknown>)
														.structuredContent as
														| Record<string, unknown>
														| undefined,
												}}
												resourceEndpoint={resourceEndpoint}
												isDark={isDark}
												autoHeight={autoHeight}
												onFollowUp={onFollowUp}
												onDisplayModeChange={
													onWidgetDisplayModeChange
														? (mode) =>
																onWidgetDisplayModeChange(mode, {
																	toolCallId: part.toolCallId,
																	resourceUri,
																	toolInput:
																		(part.input as Record<string, unknown>) ??
																		{},
																	toolResult: {
																		content: (output as Record<string, unknown>)
																			.content as
																			| Array<{
																					type: string;
																					text?: string;
																			  }>
																			| undefined,
																		structuredContent: (
																			output as Record<string, unknown>
																		).structuredContent as
																			| Record<string, unknown>
																			| undefined,
																	},
																	autoHeight,
																})
														: undefined
												}
											/>
										</WidgetErrorBoundary>
									)}
								</div>
							);
						})}
						{/* Hide text content when fullscreen */}
						<div style={fullscreenToolCallId ? { display: "none" } : undefined}>
							<MessageContent>
								{fileParts.length > 0 && <Attachments files={fileParts} />}
								{hasTextContent
									? textParts.map((part, i) => (
											<MessageResponse key={`${message.id}-${i}`}>
												{part.type === "text" ? part.text : ""}
											</MessageResponse>
										))
									: isLastAssistant && isLoading && <Loader />}
							</MessageContent>
						</div>
					</Message>
				);
			})}
			{showLoaderBubble && !fullscreenToolCallId && (
				<Message from="assistant">
					<MessageContent>
						<Loader />
					</MessageContent>
				</Message>
			)}
		</>
	);
}
