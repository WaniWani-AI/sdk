# Waniwani SDK

SDK for [app.waniwani.ai](https://app.waniwani.ai) — open-source flow engine plus optional hosted tier for tracking, KB, and chat.

## Public API tiers

The SDK ships two public tiers plus a private one. The legacy tier is gone: no `src/legacy/`, no re-exports, no entry point serving it.

### OSS (no API key required)

Truly open source. Works standalone with any state backend.

- `createFlow`, `StateGraph`, `START`, `END`, `redacted`, `createFlowTestHarness` from `@waniwani/sdk/mcp`
- `KvStore` interface, `MemoryKvStore` from `@waniwani/sdk/mcp`

`createFlow().compile()` requires either an explicit `{ store }` OR `WANIWANI_API_KEY`. With neither, it throws at compile time with a clear migration message.

### Free tier (one env var: `WANIWANI_API_KEY`)

Same SDK, hosted features added when the key is present.

- `WaniwaniKvStore` (hosted flow state) — used by `createFlow` default when key is set
- `waniwani()`, `tracking/*`, `createFrontendClient`, `EVENT_TYPES`, `withWaniwani`, `createTrackingRoute`, `widget-token`, `extractScopedClient` / `SCOPED_CLIENT_KEY` from `@waniwani/sdk` and `@waniwani/sdk/mcp`
- `createKbClient` from `@waniwani/sdk/kb`
- `useWaniwani` from `@waniwani/sdk/mcp/react` (also OSS — degrades to no-op without config; BYO endpoint also supported). Host-agnostic: takes the tool-response `_meta` as data via the `toolResponseMetadata` option, or an explicit `{ endpoint, source }`; it opens no host connection and reads no React context. Returns `{ sessionId, track, identify, flush }` where `track` is the same typed `TrackFn` as the server client; emits one `widget_render` automatically.
- `useWaniwani` from `@waniwani/sdk/mcp/react/skybridge` — the skybridge-host adapter. Reads skybridge's `useToolInfo().responseMetadata` and feeds it to the core hook, so skybridge-hosted widgets call `useWaniwani()` bare. `skybridge` is an optional peer dependency.
- `WaniwaniChat` (hosted React chat — recommended), themes, `embed.js` (IIFE for non-React hosts), `styles.css` from `@waniwani/sdk/chat`. Both expose host-page tracking: `WaniWani.chat.track` / `.identify` on the embed global, `track` / `identify` on the `ChatHandle` ref.
- `ChatEmbed` from `@waniwani/sdk/chat` — bare-bones bring-your-own-backend primitive (no `track`/`identify`). Exposed but **not** the recommended path for new code; reach for it only when self-hosting the chat backend.

Tracking is one client on four surfaces (server `waniwani()`, scoped client in handlers/flows, `useWaniwani()` in widgets, `chat.track` on chat host pages); all except the top-level server client attach session identity automatically. The scoped client exposes `sessionId`; identity accepted by ingest is `sessionId` OR `externalUserId` OR `visitorId`. `withWaniwani` injects the widget tracking config under `_meta["waniwani/widget"]`.

`withWaniwani` is no-key-safe: it wraps tools and bridges session metadata even without an API key, and its own auto-captured `tool.called` events are internally guarded (`safeTrack`). User-initiated tracking calls are **not**: `client.track.*`, `identify()`, and the scoped client throw `WANIWANI_API_KEY is not set` when no key is configured.

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
├── mcp/
│   ├── index.ts          # Public exports for @waniwani/sdk/mcp
│   ├── server/
│   │   ├── flows/        # OSS: createFlow, StateGraph
│   │   ├── kv/           # OSS interface + MemoryKvStore + WaniwaniKvStore
│   │   ├── with-waniwani/# Free tier wrapper (no-key safe)
│   │   ├── tracking-route.ts
│   │   ├── widget-token.ts
│   │   └── scoped-client.ts
│   └── react/            # useWaniwani (+ the skybridge adapter)
└── chat/
    └── web/              # Free tier chat widget (WaniwaniChat, ChatEmbed, embed.js IIFE)
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

**A feature/fix branch or PR must NEVER bump the version.** Leave `package.json`'s `version` untouched in any branch that changes code, and do not add a changelog `## <version>:` section for a version that has not been cut. The version bump is always its own separate branch and PR, cut once the code changes have landed. If a task asks for a change and a release in one go, do the code change first, then cut the bump separately — never in the same PR.

`@waniwani/sdk` is `0.x`, so **minor bumps may break the public API** — and every breaking change is a migration our users have to do. The rule: no user should have to figure out an upgrade by hand. Whenever a release contains a breaking change, ship the migration alongside it so an agent can auto-apply it in one pass.

**Every breaking change in a version bump must ship all three:**

1. **A changelog entry** — a `## <version>:` section in the docs repo (`docs/docs/sdk/changelog.mdx`, published at [docs.waniwani.ai/sdk/changelog](https://docs.waniwani.ai/sdk/changelog)) with a before/after and a mechanical, agent-applicable migration (a codemod recipe, not prose). Add it to the "Breaking changes at a glance" table too, and **link the version-specific migration skill from the section** (a `<Tip>` with the `npx skills add ... -s migrate-waniwani-sdk-<from>-to-<to>` command) so a reader can run it, not just read it.
2. **A version-specific migration skill** — `skills/migrate-waniwani-sdk-<from>-to-<to>/SKILL.md`, self-contained to that one hop (the Vercel `migrate-*`-per-major pattern), ending on `bun run typecheck && bun test`. Copy the newest existing one as the template and link it from `skills/waniwani-sdk/SKILL.md`. This is the offline, applyable form of the changelog entry: a user's agent must be able to migrate from it alone, with no network fetch.
3. **A `@deprecated` shim where feasible** — keep the old shape working with a `@deprecated` notice naming the removal version, so the bump isn't a hard cliff. Not always possible (a surface that never worked is deleted outright).

This is a standing obligation, not a per-release decision: the `.claude/skills/release-migration/` skill walks through cutting a release this way, and the user-facing upgrade path is the hosted changelog plus the per-hop migration skills. If you bump the version and touch the public API, you are not done until the changelog entry and the `migrate-waniwani-sdk-<from>-to-<to>` skill both exist and cross-link. The same discipline applies at every future version (0.15, 1.0, 15.0): a version bump always ships its migration, and the changelog always points at the skill that applies it.

## Skills (kept in sync with source)

When changing the public API or behavior, **always update the corresponding skill docs**.

### Internal skills (`.claude/skills/`, for future Claude inside this repo)

- `create-flow-app/SKILL.md` — OSS-first flow scaffolding
- `knowledge-base/SKILL.md` — KB setup (free tier)
- `visualize-flow/SKILL.md` — Mermaid diagrams from `createFlow`
- `translations/SKILL.md` — app translations
- `release-migration/SKILL.md` — cut a version bump that ships its own migration (changelog + per-hop migration skill + deprecation shim)
- (`create-mcp-app` and `mcp-server` were removed — they taught the legacy `createTool`/`createResource` patterns)

### External skills (`skills/`, published to skills.sh)

Target SDK **users**, not SDK developers.

**`waniwani-sdk/SKILL.md` carries no reference material of its own.** It is a router: a short tier summary, the common mistakes, and a map of which [docs.waniwani.ai](https://docs.waniwani.ai/sdk/introduction) page to fetch for what. There is no `references/` directory, and no new one should be created. API shapes, option names, event properties, and version behavior live in the docs repo at `/Users/maximeantoine/Projects/WaniWani/docs/docs/sdk/`, which is the single source of truth. **When you change the public API or behavior, update the matching docs page there**, and update `waniwani-sdk/SKILL.md` only if the map, the tier split, or a common mistake changed.

| Source area | Docs page to update (`docs/docs/`) |
|---|---|
| `src/mcp/server/flows/` | `sdk/flows/*.mdx`, `sdk/reference/flow-tool-contract.mdx` |
| `src/tracking/` + `src/mcp/server/scoped-client.ts` | `sdk/tracking/*.mdx`, `sdk/reference/event-schema.mdx` |
| `src/mcp/server/kv/` | `sdk/flows/kv-store.mdx`, `sdk/reference/kv-store-api.mdx` |
| `src/kb/` | `sdk/knowledge-base/overview.mdx` |
| `src/chat/web/` | `sdk/chat/embed.mdx`, `sdk/chat/react.mdx` |
| Setup / env vars / entry points | `sdk/configuration/*.mdx`, `sdk/reference/entry-points.mdx` |
| Self-hosting | `sdk/deployment/self-hosting.mdx` |
| Version upgrades / migrations | `sdk/changelog.mdx`, plus a `migrate-waniwani-sdk-<from>-to-<to>` sibling skill per hop |

Adding a docs page means adding it to `docs/docs/llms.txt` and to the map in `waniwani-sdk/SKILL.md`.

**Standalone sibling skills exist only for directly invocable workflows.** Current siblings: `instrument-tracking` (auto-instrument funnel events across flows), `audit-tracking` (read-only audit: verify only defined events are used, report missing funnel events) and per-version migration skills named `migrate-waniwani-sdk-<from>-to-<to>` (e.g. `migrate-waniwani-sdk-0.15-to-0.16`). Each sibling is self-contained and fetches the live docs for anything that can drift. Migration skills are **version-specific**, one per version hop, mirroring how Vercel ships a `migrate-*` skill per major: a user invokes exactly the skill for their jump and gets that jump's complete migration, with no version-delta logic to reason about. Before adding a new sibling skill, default to a docs page plus a row in the SKILL.md map; a sibling is justified only when users should invoke it by name (`npx skills add Waniwani-AI/sdk -s <skill>`).

Guided playbooks that walk a user through a multi-step build (init a project, create a first flow, tunnel a dev server) stay in `waniwani-sdk/scripts/*.md`. They are procedures, not reference.

**Every version bump that breaks the public API adds a new `migrate-waniwani-sdk-<from>-to-<to>` sibling skill** alongside the changelog entry required by the release rule above.

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
