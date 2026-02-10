import { z } from "zod";

/**
 * Message part schema - supports text and attachments
 */
/**
   * Chat message schema - compatible with AI SDK UIMessage.
   * Parts are passed through as-is since the AI SDK sends various part types
   * (text, tool-invocation, step-start, etc.) that convertToModelMessages handles.
   */
  const messageSchema = z.object({
      role: z.enum(["user", "assistant", "system"]),
    }).loose();
  

/**
 * POST request body schema
 */
export const postRequestBodySchema = z.object({
    // Required: conversation messages
    messages: z.array(messageSchema).min(1),
  
    // Optional: session identifier for conversation continuity
    sessionId: z.string().optional(),
  
    // Optional: model selection (defaults to env var or gpt-4o-mini)
    model: z.string().optional(),
  
    // Optional: enable/disable specific features
    enableMCP: z.boolean().default(true),
  });
  