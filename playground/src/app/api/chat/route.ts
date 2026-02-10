import { createMCPClient } from "@ai-sdk/mcp";
import { openai } from "@ai-sdk/openai";
import {
  streamText,
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  stepCountIs,
  type UIMessage,
  type ToolSet,
} from "ai";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export const maxDuration = 60;
const mcpServerUrl = "http://localhost:3000/mcp";

export async function POST(request: Request) {
  try {
    const { messages, sessionId } = await request.json();

    const modelMessages = await convertToModelMessages(
      messages as UIMessage[],
    );

    const mcp = await createMCPClient({
      transport: new StreamableHTTPClientTransport(new URL(mcpServerUrl), {
        sessionId,
      }),
    });
    const tools = await mcp.tools();

    const stream = createUIMessageStream({
      execute: async ({ writer }) => {
        const result = streamText({
          model: "openai/gpt-4.1-mini",
          system:
            "You are a helpful assistant. Keep responses concise and friendly.",
          messages: modelMessages,
          tools: tools as ToolSet,
        });

        writer.merge(result.toUIMessageStream());
      },
    });

    return createUIMessageStreamResponse({ stream });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Unknown error occurred";
    console.error("[chat] Error:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
