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

## CSS / Tailwind

All Tailwind classes in `src/chat/web/` use the `ww` prefix (e.g. `ww:flex`, `ww:bg-primary`).
This prevents the SDK's styles from leaking into host applications.

- Prefix is configured via `@import "tailwindcss" prefix(ww);` in `src/chat/web/tailwind.css`
- `tailwind-merge` is configured with `prefix: "ww"` in `src/chat/web/lib/utils.ts`
- Always use the `ww:` prefix when adding new Tailwind classes in chat components
- Theme CSS variables are prefixed too: `--color-*` becomes `--ww-color-*` in generated CSS

## Next.js Adapter (`src/chat/server/next-js/`)

Never use `Response.json()` in code that returns responses to Next.js route handlers. In Next.js 16 / Turbopack, `Response.json()` creates objects that fail Next.js's internal `instanceof Response` check. The adapter wraps all handler responses with `NextResponse` from `next/server` via `toNextResponse()` to avoid this. Keep the underlying handlers (`api-handler.ts`, `handle-chat.ts`, `handle-resource.ts`) framework-agnostic — the `NextResponse` wrapping happens only in the adapter layer.

## Design Principles

- Zero runtime dependencies
- Serverless-first (<5KB bundle)
- Type-safe end-to-end
