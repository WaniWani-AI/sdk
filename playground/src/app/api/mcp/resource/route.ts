import { createMCPClient } from "@ai-sdk/mcp";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const mcpServerUrl = process.env.MCP_SERVER_URL || "http://localhost:3000/mcp";

export async function GET(request: Request) {
	try {
		const url = new URL(request.url);
		const uri = url.searchParams.get("uri");

		if (!uri) {
			return Response.json({ error: "Missing uri parameter" }, { status: 400 });
		}

		const mcp = await createMCPClient({
			transport: new StreamableHTTPClientTransport(new URL(mcpServerUrl)),
		});

		const result = await mcp.readResource({ uri });
		await mcp.close();

		const content = result.contents[0];
		if (!content) {
			return Response.json({ error: "Resource not found" }, { status: 404 });
		}

		let html: string | undefined;
		if ("text" in content && typeof content.text === "string") {
			html = content.text;
		} else if ("blob" in content && typeof content.blob === "string") {
			html = atob(content.blob);
		}

		if (!html) {
			return Response.json(
				{ error: "Resource has no content" },
				{ status: 404 },
			);
		}

		return new Response(html, {
			headers: {
				"Content-Type": "text/html",
				"Cache-Control": "private, max-age=300",
			},
		});
	} catch (error: unknown) {
		const message =
			error instanceof Error ? error.message : "Unknown error occurred";
		console.error("[mcp/resource] Error:", message);
		return Response.json({ error: message }, { status: 500 });
	}
}
