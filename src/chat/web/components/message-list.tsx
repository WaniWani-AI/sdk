"use client";

import type { ChatStatus, ReasoningUIPart, ToolUIPart, UIMessage } from "ai";
import type { ModelContextUpdate } from "../../../shared/model-context";
import type { ShowToolCalls, WelcomeConfig } from "../@types";
import { Attachments } from "../ai-elements/attachments";
import {
	ChainOfThought,
	ChainOfThoughtContent,
	ChainOfThoughtHeader,
	ChainOfThoughtStep,
} from "../ai-elements/chain-of-thought";
import {
	Message,
	MessageContent,
	MessageResponse,
} from "../ai-elements/message";
import {
	Reasoning,
	ReasoningContent,
	ReasoningTrigger,
} from "../ai-elements/reasoning";
import {
	resolveWidgetAutoHeight,
	resolveWidgetResourceUri,
	type ToolDefinitionsMap,
	ToolInput,
	ToolOutput,
} from "../ai-elements/tool";
import {
	hasVisibleParts,
	shouldShowWorkingIndicator,
	WorkingIndicator,
} from "../ai-elements/working-indicator";
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
	/**
	 * How tool-call activity renders, grouped into one collapsible chain:
	 * `true` (default) makes each step expandable to its request/response
	 * JSON, `"titles-only"` shows step labels only, `false` hides the chain
	 * and the reasoning trace (the working indicator covers the running state
	 * instead). MCP App widgets attached to a tool call are always rendered
	 * regardless of this flag.
	 */
	showToolCalls?: ShowToolCalls;
	/**
	 * Cached tool catalog keyed by tool name. Drives spec-canonical widget
	 * resolution: if a tool's definition `_meta` carries a widget resource
	 * URI, the widget renders regardless of whether the server echoed it
	 * on the tool call result. Populated by `useChatEngine` from
	 * `GET /api/waniwani/tools`.
	 */
	toolDefinitions?: ToolDefinitionsMap;
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
	showToolCalls = true,
	toolDefinitions,
}: MessageListProps) {
	const lastMessage = messages[messages.length - 1];
	const hasMessages = messages.length > 0;

	const isFullscreenActive = fullscreenToolCallId != null;
	const showWorking =
		!isFullscreenActive &&
		shouldShowWorkingIndicator(messages, status, {
			ignoreToolParts: showToolCalls === false,
			ignoreReasoningParts: showToolCalls === false,
		});

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

				// Skip rendering an empty <Message> wrapper for an assistant
				// message that has only invisible parts (e.g. step-start, which
				// the AI SDK seeds before the first tool/text/reasoning chunk).
				// Otherwise an empty bubble briefly appears on top of the
				// WorkingIndicator before the real content lands.
				if (message.role === "assistant" && !hasVisibleParts(message)) {
					return <div key={message.id} style={{ display: "none" }} />;
				}

				// With tool calls fully hidden, an assistant message whose only
				// visible parts are widget-less tool calls (or reasoning, which
				// hidden mode also suppresses) renders nothing — collapse it so
				// it doesn't occupy a gap slot in the message column (and so the
				// WorkingIndicator stays flush while running).
				if (
					showToolCalls === false &&
					message.role === "assistant" &&
					!hasTextContent &&
					fileParts.length === 0 &&
					toolParts.every((p) => {
						const output = "output" in p ? p.output : undefined;
						return (
							output === undefined ||
							!resourceEndpoint ||
							!resolveWidgetResourceUri(p.toolName, output, toolDefinitions)
						);
					})
				) {
					return <div key={message.id} style={{ display: "none" }} />;
				}

				return (
					<Message from={message.role} key={message.id}>
						{/* Reasoning trace. Suppressed in `hidden` mode along with
						    tool calls — only the generic "On it…" indicator shows. */}
						{showToolCalls !== false &&
							!containsFullscreenTool &&
							reasoningParts.map((part, i) => (
								<Reasoning
									key={`reasoning-${message.id}-${i}`}
									isStreaming={part.state === "streaming"}
								>
									<ReasoningTrigger />
									<ReasoningContent>{part.text}</ReasoningContent>
								</Reasoning>
							))}
						{/* Tool calls grouped into one collapsible chain. `full` makes
						    each step expandable to its request/response JSON;
						    `titles-only` shows label-only steps; `hidden` renders no
						    chain (widgets below still render). */}
						{showToolCalls !== false &&
							!containsFullscreenTool &&
							toolParts.length > 0 && (
								<ChainOfThought
									isWorking={toolParts.some(
										(p) =>
											p.state === "input-available" ||
											p.state === "input-streaming",
									)}
								>
									<ChainOfThoughtHeader
										label={(() => {
											const last = toolParts[toolParts.length - 1];
											return last.title ?? formatToolName(last.toolName);
										})()}
									/>
									<ChainOfThoughtContent>
										{toolParts.map((part, i) => {
											const title = part.title ?? formatToolName(part.toolName);
											const isLast = i === toolParts.length - 1;
											if (showToolCalls === "titles-only") {
												return (
													<ChainOfThoughtStep
														key={part.toolCallId}
														title={title}
														state={part.state}
														isLast={isLast}
													/>
												);
											}
											const output = "output" in part ? part.output : undefined;
											return (
												<ChainOfThoughtStep
													key={part.toolCallId}
													title={title}
													state={part.state}
													isLast={isLast}
												>
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
												</ChainOfThoughtStep>
											);
										})}
									</ChainOfThoughtContent>
								</ChainOfThought>
							)}
						{toolParts.map((part) => {
							const output = "output" in part ? part.output : undefined;
							const resourceUri = resolveWidgetResourceUri(
								part.toolName,
								output,
								toolDefinitions,
							);
							const autoHeight = resolveWidgetAutoHeight(
								part.toolName,
								output,
								toolDefinitions,
							);
							const isFullscreen = part.toolCallId === fullscreenToolCallId;

							// This map only renders MCP App widgets now (the textual
							// tool display moved to the ChainOfThought above). A tool
							// call with no widget renders nothing here — returning an
							// empty wrapper would still occupy a gap slot in the
							// message's flex column.
							if (!(resourceUri && resourceEndpoint && output !== undefined)) {
								return null;
							}

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
									{/* Textual tool display now lives in the grouped
									    ChainOfThought above; this map only renders the
									    MCP App widget (iframe) for tool calls that carry one. */}
									{resourceUri && resourceEndpoint && output !== undefined && (
										<WidgetErrorBoundary>
											<McpAppFrame
												isFullscreen={isFullscreen}
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
													_meta: (output as Record<string, unknown>)._meta as
														| Record<string, unknown>
														| undefined,
												}}
												resourceEndpoint={resourceEndpoint}
												chatSessionId={chatSessionId}
												isDark={isDark}
												autoHeight={autoHeight}
												toolDefinitions={toolDefinitions}
												onFollowUp={onFollowUp}
												onCallTool={onCallTool}
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
										? textParts.map((part, i) => {
												const isStreamingPart =
													isLastAssistant &&
													status === "streaming" &&
													i === textParts.length - 1;
												return (
													<MessageResponse
														key={`${message.id}-${i}`}
														isStreaming={isStreamingPart}
													>
														{part.type === "text" ? part.text : ""}
													</MessageResponse>
												);
											})
										: null}
								</MessageContent>
							</div>
						)}
					</Message>
				);
			})}
			{showWorking && <WorkingIndicator />}
		</>
	);
}
