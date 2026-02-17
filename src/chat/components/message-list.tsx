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
import { McpAppFrame } from "./mcp-app-frame";

/** Converts `get_price_estimate` or `compare-prices` → `Get price estimate` / `Compare prices` */
function formatToolName(name: string): string {
	return name.replace(/[-_]/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

interface MessageListProps {
	messages: UIMessage[];
	status: ChatStatus;
	welcomeMessage?: string;
	resourceEndpoint?: string;
	isDark?: boolean;
}

export function MessageList({
	messages,
	status,
	welcomeMessage,
	resourceEndpoint,
	isDark,
}: MessageListProps) {
	const isLoading = status === "submitted" || status === "streaming";
	const lastMessage = messages[messages.length - 1];
	const hasMessages = messages.length > 0;
	const showLoaderBubble =
		isLoading && (!hasMessages || lastMessage.role === "user");

	return (
		<>
			{welcomeMessage && (
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

				return (
					<Message from={message.role} key={message.id}>
						{reasoningParts.map((part, i) => (
							<Reasoning
								key={`reasoning-${message.id}-${i}`}
								text={part.text}
							/>
						))}
						{toolParts.map((part) => {
							const output = "output" in part ? part.output : undefined;
							const resourceUri =
								output !== undefined ? getResourceUri(output) : undefined;
							const autoHeight =
								output !== undefined ? getAutoHeight(output) : false;

							return (
								<div key={part.toolCallId}>
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
									{resourceUri && output !== undefined && (
										<McpAppFrame
											resourceUri={resourceUri}
											toolInput={(part.input as Record<string, unknown>) ?? {}}
											toolResult={{
												content: (output as Record<string, unknown>).content as
													| Array<{ type: string; text?: string }>
													| undefined,
												structuredContent: (output as Record<string, unknown>)
													.structuredContent as
													| Record<string, unknown>
													| undefined,
											}}
											resourceEndpoint={resourceEndpoint}
											isDark={isDark}
											autoHeight={autoHeight}
										/>
									)}
								</div>
							);
						})}
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
					</Message>
				);
			})}
			{showLoaderBubble && (
				<Message from="assistant">
					<MessageContent>
						<Loader />
					</MessageContent>
				</Message>
			)}
		</>
	);
}
