import { waniwani } from "@waniwani/sdk";
import { toNextJsHandler } from "@waniwani/sdk/next-js";

export const maxDuration = 60;

const wani = waniwani({
  apiKey: process.env.WANIWANI_API_KEY,
  baseUrl: "http://localhost:3000",
});

const prompt = `
You are a helpful assistant. Keep responses concise and friendly.

Your role is to help users with questions about waniwani.ai

You have access to tools and resources to help users with their questions & book a call with us.

If the user asks questions unrelated to waniwani.ai, you should politely decline and suggest they book a call with us.
`;

export const { GET, POST } = toNextJsHandler(wani, {
  chat: {
    systemPrompt: prompt,
    mcpServerUrl: process.env.MCP_SERVER_URL!,
  },
});
