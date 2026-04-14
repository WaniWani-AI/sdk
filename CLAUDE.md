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
Pre-commit: Always run `bun biome check . --fix` before committing

## Skills

When making changes to the SDK's public API or behavior, **always update the corresponding skill docs** in both `.claude/skills/waniwani-sdk/` (internal) and `skills/waniwani-sdk/` (external, published to skills.sh) to keep them in sync.

### Internal skills (`.claude/skills/waniwani-sdk/`)

- `src/mcp/server/flows/` → `.claude/skills/waniwani-sdk/mcp/flows.md`
- `src/mcp/server/widgets/` → `.claude/skills/waniwani-sdk/mcp/server.md`
- `src/mcp/react/` → `.claude/skills/waniwani-sdk/mcp/react.md`
- `src/chat/web/` → `.claude/skills/waniwani-sdk/chat/react.md`
- `src/chat/web/embed/` → `.claude/skills/waniwani-sdk/chat/embed.md`

### External skills (`skills/waniwani-sdk/`)

Published to [skills.sh](https://skills.sh) via `npx skills add WaniWani-AI/sdk`. These target SDK **users** (not SDK developers).

- `src/mcp/server/flows/` → `skills/waniwani-sdk/references/flows.md` + `flows-api-reference.md`
- `src/mcp/server/widgets/` → `skills/waniwani-sdk/references/tools-and-widgets.md`
- `src/mcp/react/` → `skills/waniwani-sdk/references/widget-react-hooks.md`
- `src/chat/web/` → `skills/waniwani-sdk/references/chat-widget.md`
- `src/chat/server/` → `skills/waniwani-sdk/references/chat-server.md`
- `src/kb/` → `skills/waniwani-sdk/references/knowledge-base.md`

## CSS / Tailwind

All Tailwind classes in `src/chat/web/` use the `ww` prefix (e.g. `ww:flex`, `ww:bg-primary`).
This prevents the SDK's styles from leaking into host applications.

- Prefix is configured via `@import "tailwindcss" prefix(ww);` in `src/chat/web/tailwind.css`
- `tailwind-merge` is configured with `prefix: "ww"` in `src/chat/web/lib/utils.ts`
- Always use the `ww:` prefix when adding new Tailwind classes in chat components
- Theme CSS variables are prefixed too: `--color-*` becomes `--ww-color-*` in generated CSS

## Design Principles

- Zero runtime dependencies
- Serverless-first (<5KB bundle)
- Type-safe end-to-end
