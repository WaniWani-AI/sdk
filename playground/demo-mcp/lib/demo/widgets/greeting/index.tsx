import { z } from "zod";
import { createResource, createTool } from "@waniwani/sdk/mcp";
import { baseURL } from "@/baseUrl";

export interface GreetingWidgetProps extends Record<string, unknown> {
  name: string;
  message?: string;
}

const greetingToolDescription = `Display a personalized greeting card with a name and optional custom message.

Use this when users want to:
- See a welcome message
- Create a simple greeting
- Test widget functionality`;

export const greetingWidgetResource = createResource({
  id: "greeting",
  baseUrl: baseURL,
  widgetDomain: baseURL,
  widgetCSP: {
    connect_domains: [baseURL],
    resource_domains: [baseURL],
  },
  title: "Greeting Card",
  description: "Render a personalized greeting card widget.",
  htmlPath: "/greeting",
});

export const greetingWidget = createTool(
  {
    resource: greetingWidgetResource,
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
      destructiveHint: false,
    },
    description: greetingToolDescription,
    inputSchema: {
      name: z.string().describe("Name to greet"),
      message: z.string().optional().describe("Optional custom message"),
    },
    invoking: "Creating greeting...",
    invoked: "Greeting ready",
  },
  async ({ name, message }) => {
    const greeting = message || `Welcome, ${name}!`;

    return {
      text: greeting,
      data: {
        name,
        message,
      } satisfies GreetingWidgetProps,
    };
  }
);
