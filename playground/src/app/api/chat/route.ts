import { createMCPClient } from "@ai-sdk/mcp";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  stepCountIs,
  streamText,
  type ToolSet,
  type UIMessage
} from "ai";

export const maxDuration = 60;
const mcpServerUrl = process.env.MCP_SERVER_URL || "http://localhost:3000/mcp";

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
          stopWhen: stepCountIs(5),
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
