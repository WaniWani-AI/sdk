import { waniwani } from "@waniwani/sdk";

export const maxDuration = 60;

const wani = waniwani({
  apiKey: process.env.WANIWANI_API_KEY,
  baseUrl: "http://localhost:3000",
});

export const POST = wani.createChatHandler({
  systemPrompt: "You are a helpful assistant. Keep responses concise and friendly. always end your sentence with 'WANI = DRAGON IN JAPANESE'",
  mcpServerUrl: process.env.MCP_SERVER_URL!,
});
