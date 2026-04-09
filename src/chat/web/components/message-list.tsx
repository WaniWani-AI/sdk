"use client";

import type { ChatStatus, ReasoningUIPart, ToolUIPart, UIMessage } from "ai";
import type { ModelContextUpdate } from "../../../shared/model-context";

import type { WelcomeConfig } from "../@types";
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
	getHttpUrl,
	getResourceUri,
	Tool,
	ToolContent,
	ToolHeader,
	ToolInput,
	ToolOutput,
} from "../ai-elements/tool";
import type { McpAppDisplayMode } from "./mcp-app-frame";
import { McpAppFrame } from "./mcp-app-frame";
import { WelcomeScreen } from "./welcome-screen";
import { WidgetErrorBoundary } from "./widget-error-boundary";

/** Converts `get_price_estimate` or `compare-prices` → `Get price estimate` / `Compare prices` */
function formatToolName(name: string | undefined): string {
	if (!name) {
		return "Tool";
	}

	return name.replace(/[-_]/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

export interface FullscreenWidget {
	toolCallId: string;
	resourceUri: string;
	httpUrl?: string;
	toolInput: Record<string, unknown>;
	toolResult: {
		content?: Array<{ type: string; text?: string }>;
		structuredContent?: Record<string, unknown>;
		_meta?: Record<string, unknown>;
	};
	autoHeight: boolean;
}

interface MessageListProps {
	messages: UIMessage[];
	status: ChatStatus;
	welcomeMessage?: string;
	/** Rich welcome screen config. Takes precedence over `welcomeMessage`. */
	welcome?: WelcomeConfig;
	/** Called when a welcome screen suggestion card is clicked. */
	onSuggestionSelect?: (suggestion: string) => void;
	resourceEndpoint?: string;
	chatSessionId?: string;
	isDark?: boolean;
	onFollowUp?: (message: {
		role: string;
		content: Array<{ type: string; text?: string }>;
		modelContext?: ModelContextUpdate;
	}) => void;
	onCallTool?: (params: {
		name: string;
		arguments: Record<string, unknown>;
	}) => Promise<{
		content?: Array<{ type: string; text?: string }>;
		structuredContent?: Record<string, unknown>;
		_meta?: Record<string, unknown>;
	}>;
	onWidgetDisplayModeChange?: (
		mode: McpAppDisplayMode,
		widget: FullscreenWidget,
	) => void;
	/** When set, only the matching widget is shown (fullscreen mode). The iframe stays mounted. */
	fullscreenToolCallId?: string | null;
	/** When true, show _meta in tool call inputs and outputs. */
	debug?: boolean;
}

export function MessageList({
	messages,
	status,
	welcomeMessage,
	welcome,
	onSuggestionSelect,
	resourceEndpoint,
	chatSessionId,
	isDark,
	onFollowUp,
	onCallTool,
	onWidgetDisplayModeChange,
	fullscreenToolCallId,
	debug,
}: MessageListProps) {
	const isLoading = status === "submitted" || status === "streaming";
	const lastMessage = messages[messages.length - 1];
	const hasMessages = messages.length > 0;
	const showLoaderBubble =
		isLoading && (!hasMessages || lastMessage.role === "user");

	const isFullscreenActive = fullscreenToolCallId != null;

	return (
		<>
			{!isFullscreenActive &&
				(!hasMessages && welcome ? (
					<WelcomeScreen {...welcome} onSuggestionSelect={onSuggestionSelect} />
				) : (
					welcomeMessage && (
						<Message from="assistant">
							<MessageContent>
								<MessageResponse>{welcomeMessage}</MessageResponse>
							</MessageContent>
						</Message>
					)
				))}
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
				const containsFullscreenTool = isFullscreenActive
					? toolParts.some((p) => p.toolCallId === fullscreenToolCallId)
					: false;

				// Hide messages that don't contain the fullscreen widget
				if (isFullscreenActive && !containsFullscreenTool) {
					return <div key={message.id} style={{ display: "none" }} />;
				}

				return (
					<Message from={message.role} key={message.id}>
						{!containsFullscreenTool &&
							reasoningParts.map((part, i) => (
								<Reasoning
									key={`reasoning-${message.id}-${i}`}
									text={part.text}
								/>
							))}
						{toolParts.map((part) => {
							const output = "output" in part ? part.output : undefined;
							const resourceUri =
								output !== undefined ? getResourceUri(output) : undefined;
							const httpUrl =
								output !== undefined ? getHttpUrl(output) : undefined;
							const autoHeight =
								output !== undefined ? getAutoHeight(output) : false;
							const isFullscreen = part.toolCallId === fullscreenToolCallId;

							return (
								<div
									key={part.toolCallId}
									style={
										isFullscreen
											? {
													position: "absolute" as const,
													inset: 0,
													zIndex: 10,
													display: "flex",
													flexDirection: "column" as const,
													overflow: "hidden",
													background: "var(--ww-color-background)",
												}
											: undefined
									}
								>
									<div style={isFullscreen ? { display: "none" } : undefined}>
										<Tool>
											<ToolHeader
												title={part.title ?? formatToolName(part.toolName)}
												state={part.state}
											/>
											<ToolContent>
												<ToolInput input={part.input} debug={debug} />
												{output !== undefined && (
													<ToolOutput
														output={output}
														errorText={
															"errorText" in part ? part.errorText : undefined
														}
														debug={debug}
													/>
												)}
											</ToolContent>
										</Tool>
									</div>
									{resourceUri &&
										(resourceEndpoint || httpUrl) &&
										output !== undefined && (
											<WidgetErrorBoundary>
												<McpAppFrame
													isFullscreen={isFullscreen}
													resourceUri={resourceUri}
													httpUrl={httpUrl}
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
														structuredContent: (
															output as Record<string, unknown>
														).structuredContent as
															| Record<string, unknown>
															| undefined,
														_meta: (output as Record<string, unknown>)._meta as
															| Record<string, unknown>
															| undefined,
													}}
													resourceEndpoint={resourceEndpoint}
													chatSessionId={chatSessionId}
													isDark={isDark}
													autoHeight={autoHeight}
													onFollowUp={onFollowUp}
													onCallTool={onCallTool}
													onDisplayModeChange={
														onWidgetDisplayModeChange
															? (mode) =>
																	onWidgetDisplayModeChange(mode, {
																		toolCallId: part.toolCallId,
																		resourceUri,
																		httpUrl,
																		toolInput:
																			(part.input as Record<string, unknown>) ??
																			{},
																		toolResult: {
																			content: (
																				output as Record<string, unknown>
																			).content as
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
																			_meta: (output as Record<string, unknown>)
																				._meta as
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
						{!containsFullscreenTool && (
							<div>
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
						)}
					</Message>
				);
			})}
			{!isFullscreenActive && showLoaderBubble && (
				<Message from="assistant">
					<MessageContent>
						<Loader />
					</MessageContent>
				</Message>
			)}
		</>
	);
}
