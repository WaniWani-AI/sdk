# WaniWani SDK

SDK for [app.waniwani.ai](https://app.waniwani.ai) - MCP event tracking and tools.

## Project Structure

```
src/
├── index.ts              # SDK exports
└── tracking/
    └── index.ts          # Event tracking implementation
```

## Usage

```typescript
import { waniwani } from "@waniwani";

const client = waniwani({
  apiKey: "...",  // or use WANIWANI_API_KEY env var
});

// Track events
await client.track({
  event: "tool.called",
  properties: { name: "pricing", type: "pricing" },
  meta: extra._meta  // MCP request metadata
});

// Get or create session from MCP metadata
const sessionId = await client.getOrCreateSession(meta);
```

## Configuration

- `apiKey`: Your MCP environment API key (defaults to `WANIWANI_API_KEY` env var)
- `baseUrl`: API base URL (defaults to `https://app.waniwani.ai`)

## Commands

**Important**: Only use `bun` for this project.

Build: `bun run build`
Dev: `bun run dev`
Lint: `bun run lint`

## Skills

When making changes to the SDK's public API or behavior, **always update the corresponding skill docs** in `.claude/skills/waniwani-sdk/` to keep them in sync. Key mappings:

- `src/mcp/server/flows/` → `.claude/skills/waniwani-sdk/mcp/flows.md`
- `src/mcp/server/widgets/` → `.claude/skills/waniwani-sdk/mcp/server.md`
- `src/mcp/react/` → `.claude/skills/waniwani-sdk/mcp/react.md`
- `src/chat/web/` → `.claude/skills/waniwani-sdk/chat/react.md`
- `src/chat/web/embed/` → `.claude/skills/waniwani-sdk/chat/embed.md`

## Design Principles

- Zero runtime dependencies
- Serverless-first (<5KB bundle)
- Type-safe end-to-end
