import { openai } from "@ai-sdk/openai";
import {
  streamText,
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  type UIMessage,
} from "ai";

export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const { messages } = await request.json();

    const modelMessages = await convertToModelMessages(
      messages as UIMessage[],
    );

    const stream = createUIMessageStream({
      execute: async ({ writer }) => {
        const result = streamText({
          model: "openai/gpt-4.1-mini",
          system:
            "You are a helpful assistant. Keep responses concise and friendly.",
          messages: modelMessages,
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
