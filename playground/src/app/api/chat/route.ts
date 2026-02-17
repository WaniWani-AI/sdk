import { createChatHandler } from "@waniwani/sdk/chat/server";

export const maxDuration = 60;

export const POST = createChatHandler({
  systemPrompt: "You are a helpful assistant. Keep responses concise and friendly.",
  mcpServerUrl: process.env.MCP_SERVER_URL || "http://localhost:3000/mcp",
});
