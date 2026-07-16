# Waniwani SDK

SDK for [app.waniwani.ai](https://app.waniwani.ai) — open-source flow engine plus optional hosted tier for tracking, KB, and chat.

## Public API tiers

The SDK ships three tiers. **When recommending APIs for new code, always use OSS or Free Tier — never Legacy.**

### OSS (no API key required)

Truly open source. Works standalone with any state backend.

- `createFlow`, `StateGraph`, `START`, `END`, `redacted`, `createFlowTestHarness` from `@waniwani/sdk/mcp`
- `KvStore` interface, `MemoryKvStore` from `@waniwani/sdk/mcp`

`createFlow().compile()` requires either an explicit `{ store }` OR `WANIWANI_API_KEY`. With neither, it throws at compile time with a clear migration message.

### Free tier (one env var: `WANIWANI_API_KEY`)

Same SDK, hosted features added when the key is present.

- `WaniwaniKvStore` (hosted flow state) — used by `createFlow` default when key is set
- `waniwani()`, `tracking/*`, `withWaniwani`, `createTrackingRoute`, `widget-token`, `scoped-client` from `@waniwani/sdk` and `@waniwani/sdk/mcp`
- `createKbClient` from `@waniwani/sdk/kb`
- `useWaniwani` from `@waniwani/sdk/mcp/react` (also OSS — degrades to no-op without config; BYO endpoint also supported)
- `WaniwaniChat` (hosted React chat — recommended), themes, `embed.js` (IIFE for non-React hosts), `styles.css` from `@waniwani/sdk/chat`
- `ChatEmbed` from `@waniwani/sdk/chat` — bare-bones bring-your-own-backend primitive. Exposed but **not** the recommended path for new code; reach for it only when self-hosting the chat backend.

`withWaniwani` is no-key-safe: it wraps tools and bridges session metadata even without an API key, and its own auto-captured `tool.called` events are internally guarded (`safeTrack`). User-initiated tracking calls are **not**: `client.track.*`, `identify()`, and the scoped client throw `WANIWANI_API_KEY is not set` when no key is configured.

### Legacy (preserved, undocumented, marked `@deprecated`)

Still used by ~14 internal customer MCPs. Kept exported for back-compat. **Never suggest these for new code.** They will move to dedicated `@waniwani/sdk/legacy*` entry points in a future minor release.

- `createTool`, `createResource`, `registerTools` from `@waniwani/sdk/mcp`
- `toNextJsHandler` (`@waniwani/sdk/next-js`), `toExpressJsHandler` (`@waniwani/sdk/express-js`), `createApiHandler` (`@waniwani/sdk/chat/server`)
- `ChatCard` (and `ChatCardProps`) — canonical import is now `@waniwani/sdk/legacy`. Still re-exported from `@waniwani/sdk/chat` for back-compat; that re-export will be removed in a future minor release. Superseded by `WaniwaniChat`.
- All MCP-widget React hooks except `useWaniwani`: `WidgetProvider`, `useWidgetClient`, `useDisplayMode`, `useToolOutput`, `useSafeArea`, `useMaxHeight`, `useTheme`, `useLocale`, `useCallTool`, `useSendFollowUp`, `useFlowAction`, `useUpdateModelContext`, `useRequestDisplayMode`, `useToolResponseMetadata`, `useWidgetState`, `useIsChatGptApp`, `useOpenExternal`
- `InitializeNextJsInIframe`, `LoadingWidget`, `DevModeProvider`, mocks, `detectPlatform`, `isMCPApps`, `isOpenAI`

### Internal (not part of the public API)

`@waniwani/sdk/internal` is a private entry point for the Waniwani platform (app.waniwani.ai) to reuse SDK primitives that should not be exposed to third-party consumers. **Never document these in user-facing docs. Never suggest them for new code outside the Waniwani monorepo.**

- `replayScenario`, `ConversationTurnResult`, `ConversationResult`, `EvalScenario`, `ChatResult`, `ToolCallTrace`, `TurnAssertion`, `EvalScenarioType` from `@waniwani/sdk/internal` — replay a recorded UIMessage conversation against an MCP-backed chat server. Used by the compliance/evals features in the app.

The old `@waniwani/sdk/evals` public entry (with `chat`, `conversation`, `saveScenario`, `loadScenarios`, `braintrust`/`autoevals` scorers) was removed and is **not** restored at `/internal` — only the surface the app actually uses.

## Project structure

```
src/
├── index.ts              # waniwani() client, defineConfig, WaniWaniError
├── waniwani.ts
├── tracking/             # Event tracking (free tier)
├── kb/                   # Knowledge base (free tier)
├── internal/             # Private surface for app.waniwani.ai (replayScenario)
├── legacy/               # LEGACY entry points (createTool, createResource, chat-server adapters, ChatCard)
├── mcp/
│   ├── index.ts          # Public exports for @waniwani/sdk/mcp
│   ├── server/
│   │   ├── flows/        # OSS: createFlow, StateGraph
│   │   ├── kv/           # OSS interface + MemoryKvStore + WaniwaniKvStore
│   │   ├── tools/        # LEGACY: createTool
│   │   ├── resources/    # LEGACY: createResource
│   │   ├── with-waniwani/# Free tier wrapper (no-key safe)
│   │   ├── tracking-route.ts
│   │   ├── widget-token.ts
│   │   └── scoped-client.ts
│   └── react/            # Mostly LEGACY (only useWaniwani is non-legacy)
└── chat/
    ├── web/              # Free tier chat widget (WaniwaniChat, ChatEmbed, embed.js IIFE)
    └── server/           # Back-compat shim — re-exports from `src/legacy/chat/server/`
```

## Usage

OSS — no API key:

```ts
import { createFlow, MemoryKvStore, START, END } from "@waniwani/sdk/mcp";
import { z } from "zod";

const flow = createFlow({ id: "demo", title: "Demo", description: "…", state: { v: z.string() } })
  .addNode("done", () => ({ v: "ok" }))
  .addEdge(START, "done")
  .addEdge("done", END)
  .compile({ store: new MemoryKvStore() });
```

Free tier — with API key:

```ts
// WANIWANI_API_KEY=wwk_... in env
const flow = createFlow({ /* …same… */ }).compile(); // hosted flow state, automatic
```

## Commands

**Only use `bun`.**

- Build: `bun run build`
- Dev: `bun run dev`
- Typecheck: `bun run typecheck`
- Lint: `bun run lint`
- Test: `bun test`
- Pre-commit: always run `bun biome check . --fix`

## Releasing (version bumps)

`@waniwani/sdk` is `0.x`, so **minor bumps may break the public API** — and every breaking change is a migration our users have to do. The rule: no user should have to figure out an upgrade by hand. Whenever a release contains a breaking change, ship the migration alongside it so an agent can auto-apply it in one pass.

**Every breaking change in a version bump must ship all three:**

1. **A changelog entry** — a `## <version>:` section with a before/after and a mechanical, agent-applicable migration (a codemod recipe, not prose). Add it to the "Breaking changes at a glance" table too.
2. **An entry in `skills/waniwani-sdk/references/upgrading.md`** — under "Currently auto-fixable breaking changes", mirroring the changelog so an agent can migrate without a network fetch.
3. **A `@deprecated` shim where feasible** — keep the old shape working with a `@deprecated` notice naming the removal version, so the bump isn't a hard cliff.

This is a standing obligation, not a per-release decision: the `.claude/skills/release-migration/` skill walks through cutting a release this way, and the user-facing upgrade path lives in `skills/waniwani-sdk/references/upgrading.md`. If you bump the version and touch the public API, you are not done until the migration for it exists. The same discipline applies at every future version (0.15, 1.0, 15.0): a version bump always ships its migration.

## Skills (kept in sync with source)

When changing the public API or behavior, **always update the corresponding skill docs**.

### Internal skills (`.claude/skills/`, for future Claude inside this repo)

- `create-flow-app/SKILL.md` — OSS-first flow scaffolding
- `knowledge-base/SKILL.md` — KB setup (free tier)
- `visualize-flow/SKILL.md` — Mermaid diagrams from `createFlow`
- `translations/SKILL.md` — app translations
- `release-migration/SKILL.md` — cut a version bump that ships its own migration (changelog + `upgrading.md` + deprecation shim)
- (`create-mcp-app` and `mcp-server` were removed — they taught the legacy `createTool`/`createResource` patterns)

### External skills (`skills/waniwani-sdk/`, published to skills.sh)

Target SDK **users**, not SDK developers.

| Source area | Reference file |
|---|---|
| `src/mcp/server/flows/` | `references/flows.md` + `flows-api-reference.md` |
| `src/tracking/` + `src/mcp/server/scoped-client.ts` | `references/events.md` (NEW) |
| `src/mcp/server/kv/` | `references/kv-store.md` (NEW) |
| Self-hosting | `references/self-hosting.md` (NEW) |
| `src/kb/` | `references/knowledge-base.md` |
| `src/chat/web/` | `references/chat-widget.md` |
| Setup / env vars | `references/setup.md` |
| **Legacy** (not linked from `SKILL.md`) | `references/_legacy/tools-and-widgets.md`, `references/_legacy/widget-react-hooks.md`, `references/_legacy/chat-server.md` |

## CSS / Tailwind

All Tailwind classes in `src/chat/web/` use the `ww` prefix (e.g. `ww:flex`, `ww:bg-primary`). This prevents the SDK's styles from leaking into host applications.

- Prefix is configured via `@import "tailwindcss" prefix(ww);` in `src/chat/web/tailwind.css`
- `tailwind-merge` is configured with `prefix: "ww"` in `src/chat/web/lib/utils.ts`
- Always use the `ww:` prefix when adding new Tailwind classes in chat components
- Theme CSS variables are prefixed too: `--color-*` becomes `--ww-color-*` in generated CSS

## Design principles

- **OSS first, hosted opt-in.** Anything documented for new code should work without an API key, or clearly state that the key is required and explain what it unlocks.
- Zero runtime dependencies on the core path.
- Serverless-first (<5KB core bundle).
- Type-safe end-to-end (Zod state schemas, inferred node contexts).
