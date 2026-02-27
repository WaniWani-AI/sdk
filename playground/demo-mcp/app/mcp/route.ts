import { registerAllTools } from "@/lib/demo/tools";
import { registerTools, withWaniwani } from "@waniwani/sdk/mcp";
import {
  greetingWidget,
  greetingWidgetResource,
} from "@/lib/demo/widgets/greeting";
import { createMcpHandler } from "mcp-handler";

const handler = createMcpHandler(async (server) => {
  // Wrap server with withWaniwani — auto-tracks all tool calls
  withWaniwani(server, {
    config: {
      apiKey: process.env.WANIWANI_API_KEY,
      baseUrl: process.env.WANIWANI_BASE_URL ?? "http://localhost:3000",
    },
    flushAfterToolCall: true,
  });

  // Register all tools (tracked automatically via withWaniwani)
  registerAllTools(server);

  // Register widget resource + tool
  await greetingWidgetResource.register(server);
  await registerTools(server, [greetingWidget]);
});

export { handler as GET, handler as POST };
