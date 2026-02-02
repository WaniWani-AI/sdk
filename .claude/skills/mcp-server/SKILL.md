---
name: mcp-server
description: Create and configure MCP (Model Context Protocol) servers with tools. Use when creating MCP server tools, updating existing MCP implementations, or working with the @modelcontextprotocol/sdk package.
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
---

# MCP Server Development Guide

Guide for creating MCP servers using the `@modelcontextprotocol/sdk` TypeScript SDK.

## Package Information

- **Package**: `@modelcontextprotocol/sdk`
- **Documentation**: https://modelcontextprotocol.io/
- **GitHub**: https://github.com/modelcontextprotocol/typescript-sdk

## Tool Registration API

**IMPORTANT**: Use `server.registerTool()` for the full-featured API with title, description, and output schemas.

### Modern API: `registerTool()` (Recommended)

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const server = new McpServer({
  name: "my-server",
  version: "1.0.0",
});

server.registerTool(
  "tool-name",
  {
    title: "Human Readable Title",
    description: "Detailed description of what the tool does",
    inputSchema: {
      param1: z.string().describe("Description of param1"),
      param2: z.number().optional().describe("Optional number parameter"),
    },
    outputSchema: {
      // Optional but recommended for structured responses
      success: z.boolean(),
      data: z.any(),
    },
  },
  async ({ param1, param2 }, extra) => {
    // Tool implementation
    const output = { success: true, data: { result: param1 } };

    return {
      content: [{ type: "text", text: JSON.stringify(output) }],
      structuredContent: output, // Optional: typed output matching outputSchema
    };
  }
);
```

## Response Format

Tools must return a response with `content` array:

```typescript
// Text response
return {
  content: [
    {
      type: "text" as const,
      text: JSON.stringify({ success: true, data: result }, null, 2),
    },
  ],
};

// With structured content (when using outputSchema)
return {
  content: [{ type: "text", text: JSON.stringify(output) }],
  structuredContent: output,
};
```

## Authentication Pattern

For authenticated MCP servers, access auth info via `extra.authInfo`:

```typescript
server.registerTool(
  "protected-tool",
  {
    title: "Protected Tool",
    description: "Requires authentication",
    inputSchema: { data: z.string() },
  },
  async ({ data }, extra) => {
    // Verify authentication
    if (!extra.authInfo?.userId) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ success: false, error: "Unauthorized" }),
          },
        ],
      };
    }

    // Proceed with authenticated logic
    // ...
  }
);
```

## Error Handling Pattern

Wrap tool logic in try-catch and return consistent error responses:

```typescript
server.registerTool(
  "my-tool",
  {
    title: "My Tool",
    description: "Tool description",
    inputSchema: { id: z.string().uuid() },
  },
  async ({ id }, extra) => {
    try {
      // Your logic here
      const result = await doSomething(id);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ success: true, data: result }, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              success: false,
              error: error instanceof Error ? error.message : "Unknown error",
            }),
          },
        ],
      };
    }
  }
);
```

## Input Schema Patterns

### Required parameters

```typescript
inputSchema: {
  id: z.string().uuid().describe("The resource ID"),
  name: z.string().min(1).describe("Resource name"),
}
```

### Optional parameters with defaults

```typescript
inputSchema: {
  limit: z.number().int().min(1).max(100).optional().default(50)
    .describe("Maximum results to return"),
  offset: z.number().int().min(0).optional().default(0)
    .describe("Number of results to skip"),
}
```

### Enum parameters

```typescript
inputSchema: {
  status: z.enum(["pending", "approved", "rejected"])
    .describe("Filter by status"),
}
```

### Confirmation for destructive actions

```typescript
inputSchema: {
  id: z.string().uuid().describe("ID to delete"),
  confirm: z.literal(true)
    .describe("Must be true to confirm deletion. This action is irreversible."),
}
```

## Project Structure

Organize MCP server code like this:

```
src/lib/mcp/
└── my-server/
    ├── index.ts           # Main exports
    ├── @auth.ts           # Authentication logic
    └── tools/
        ├── index.ts       # Tool registration orchestrator
        ├── feature1.ts    # Feature 1 tools
        └── feature2.ts    # Feature 2 tools
```

### tools/index.ts

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerFeature1Tools } from "./feature1";
import { registerFeature2Tools } from "./feature2";

export function registerAllTools(server: McpServer) {
  registerFeature1Tools(server);
  registerFeature2Tools(server);
}
```

### tools/feature1.ts

```typescript
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerFeature1Tools(server: McpServer) {
  server.registerTool(
    "feature1_action",
    {
      title: "Feature 1 Action",
      description: "Does something for feature 1",
      inputSchema: { param: z.string() },
    },
    async ({ param }, extra) => {
      // Implementation
    }
  );
}
```

## HTTP Transport Setup

For Next.js API routes with `mcp-handler`:

```typescript
// src/app/api/mcp/my-server/route.ts
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { registerAllTools } from "@/lib/mcp/my-server/tools";
import { verifyApiKey } from "@/lib/mcp/my-server/@auth";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";

const handler = createMcpHandler(
  (server) => {
    registerAllTools(server);
  },
  {},
  {
    basePath: "/api/mcp/my-server",
    verboseLogs: process.env.NODE_ENV === "development",
  }
);

const verifyToken = async (
  _req: Request,
  bearerToken?: string
): Promise<AuthInfo> => {
  return verifyApiKey(bearerToken);
};

const authHandler = withMcpAuth(handler, verifyToken, {
  required: true,
  resourceMetadataPath: "/.well-known/oauth-protected-resource",
});

export { authHandler as GET, authHandler as POST, authHandler as DELETE };
```

## Common Mistakes to Avoid

### ❌ Using old `server.tool()` without proper structure

```typescript
// OUTDATED for complex tools
server.tool("my-tool", { param: z.string() }, async ({ param }) => { ... });
```

### ✅ Use `registerTool()` with title and description

```typescript
// MODERN - full-featured
server.registerTool(
  "my-tool",
  {
    title: "My Tool",
    description: "Tool description",
    inputSchema: { param: z.string() },
  },
  async ({ param }, extra) => { ... }
);
```

### ❌ Not using `as const` for type in content

```typescript
// Missing type assertion
return { content: [{ type: "text", text: "..." }] };
```

### ✅ Always use `as const` for type literal

```typescript
return { content: [{ type: "text" as const, text: "..." }] };
```

### ❌ Not validating/describing input parameters

```typescript
inputSchema: { id: z.string() }  // Missing validation and description
```

### ✅ Add validation and descriptions

```typescript
inputSchema: {
  id: z.string().uuid().describe("The resource UUID"),
}
```

## Tool Naming Convention

Use snake_case for tool names with descriptive prefixes:

- `list_*` - List resources
- `get_*` - Get single resource
- `create_*` - Create resource
- `update_*` - Update resource
- `delete_*` - Delete resource (require confirmation)
- `enable_*` / `disable_*` - Toggle features

Examples: `list_orgs`, `create_user`, `update_sharing_config`, `delete_org`
