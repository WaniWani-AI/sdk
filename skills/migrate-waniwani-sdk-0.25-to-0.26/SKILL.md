---
name: migrate-waniwani-sdk-0.25-to-0.26
description: "Migrate a project from @waniwani/sdk 0.25.x to 0.26.x. 0.26 moves the chat widget out of @waniwani/sdk into its own package, @waniwani/chat: `@waniwani/sdk/chat` imports become `@waniwani/chat`, `@waniwani/sdk/chat/styles.css` becomes `@waniwani/chat/styles.css`, and a self-hosted `@waniwani/sdk/dist/chat/embed.js` becomes `@waniwani/chat/dist/embed.js`. The old paths keep working until 0.28.0 once @waniwani/chat is installed. Trigger when the user is on 0.25.x and wants 0.26, or after bumping sees `Cannot find module '@waniwani/chat'`, `Module not found: Can't resolve '@waniwani/chat'`, or `@deprecated` warnings on WaniwaniChat, ChatEmbed or other chat imports."
metadata:
  author: Waniwani
---

# Migrate `@waniwani/sdk` 0.25 → 0.26

A self-contained migration for the hop to `0.26.x`. For other version boundaries use the matching `migrate-waniwani-sdk-<from>-to-<to>` skill, or the general procedure in the SDK's [changelog](https://docs.waniwani.ai/sdk/changelog).

**Precondition:** the project is on `@waniwani/sdk@0.25.x`. On an older version, migrate up to 0.25 first.

A project that never uses the chat widget has almost nothing to migrate. Bump the dependency, run the completion check, and stop. Step 2 below tells you which case you are in.

## What 0.26 changes

The chat widget (`WaniwaniChat`, `ChatEmbed`, the themes, `styles.css` and `embed.js`) ships in its own npm package, `@waniwani/chat`. `@waniwani/sdk` keeps the server side: flows, the KV stores, tracking, the knowledge base, documents, `withWaniwani` and `useWaniwani`. An MCP server that only uses `createFlow` now installs about 1.7 MB instead of 32 MB.

`@waniwani/chat` exports the same 26 names that `@waniwani/sdk/chat` exported, with the same types and the same behavior. Only the import path moves.

| Old path | New path | Until 0.28.0 |
| --- | --- | --- |
| `@waniwani/sdk/chat` | `@waniwani/chat` | Re-exports `@waniwani/chat`, each name marked `@deprecated` |
| `@waniwani/sdk/chat/styles.css` | `@waniwani/chat/styles.css` | One `@import` of the new stylesheet |
| `@waniwani/sdk/chat/embed.js`, `node_modules/@waniwani/sdk/dist/chat/embed.js` | `@waniwani/chat/embed.js`, `node_modules/@waniwani/chat/dist/embed.js` | A copy of the embed |
| `cdn.jsdelivr.net/npm/@waniwani/sdk@<v>/dist/chat/embed.js` | The dashboard snippet, which loads `https://app.waniwani.ai/embed.js` (EU: `https://eu.app.waniwani.ai/embed.js`) | The old URLs stay on the CDN. They never update |

Breaking, and visible to the build: `@waniwani/chat` is an optional peer of `@waniwani/sdk`, so the old `@waniwani/sdk/chat` path fails with `Cannot find module '@waniwani/chat'` until the project installs it.

Not breaking:

- **Script-tag sites that use the dashboard snippet.** The snippet loads `app.waniwani.ai/embed.js`, a loader that picks the bundle. Nothing on the page changes.
- **`@ai-sdk/mcp`.** `@waniwani/sdk` no longer lists it as an optional peer. Nothing in the SDK imported it. A project that installed it only for the SDK can remove it.
- **Peer dependencies of the chat.** `@waniwani/chat` needs `react`, `ai`, `@ai-sdk/react` and `zod`, the same packages the chat needed inside `@waniwani/sdk`. npm 7 and later, pnpm and bun install missing peers.
- **Tracking.** `createFrontendClient`, `EVENT_TYPES` and `useWaniwani` stay in `@waniwani/sdk`. The chat's `track` and `identify` keep the same shape.

## Procedure

1. **Bump the SDK.** Use the project's package manager (bun shown).
   ```bash
   bun add @waniwani/sdk@^0.26.0
   ```
2. **Collect the chat call sites.**
   ```bash
   rg -n "@waniwani/sdk/chat|@waniwani/sdk/dist/chat|@waniwani/sdk@[^/\"' ]*/dist/chat" --glob '!node_modules' --glob '!*.lock' --glob '!package-lock.json'
   rg -n "@waniwani/sdk" -g 'next.config.*' -g 'vite.config.*' -g 'jest.config.*' -g 'vitest.config.*' -g 'tsconfig*.json'
   ```
   No hit in the first command: the project does not use the chat. Skip to step 6.
3. **Install the chat.**
   ```bash
   bun add @waniwani/chat@^0.26.0
   ```
4. **Rewrite every hit** with the rules below. Each one is a plain text replacement.

   | Match | Replace with |
   | --- | --- |
   | `"@waniwani/sdk/chat"` in an `import`, `export … from`, `import()`, `require()`, `vi.mock()`, `jest.mock()` or `mock.module()` | `"@waniwani/chat"` |
   | `@waniwani/sdk/chat/styles.css` in a JS import or a CSS `@import` | `@waniwani/chat/styles.css` |
   | `@waniwani/sdk/chat/embed.js` | `@waniwani/chat/embed.js` |
   | `@waniwani/sdk/dist/chat/embed.js`, for example in a copy step or a static route | `@waniwani/chat/dist/embed.js` (the `chat/` folder is gone from the path) |
   | `"@waniwani/sdk"` in `transpilePackages`, `optimizePackageImports`, `serverExternalPackages`, a Jest `moduleNameMapper` or a `tsconfig` `paths` entry that exists for the chat | Add `"@waniwani/chat"` next to it. Keep `"@waniwani/sdk"` when other code still imports it |
   | A `<script src>` with `cdn.jsdelivr.net/npm/@waniwani/sdk@…/dist/chat/embed.js` | `https://app.waniwani.ai/embed.js`, or `https://eu.app.waniwani.ai/embed.js` for an EU project. Keep every `data-*` attribute as it is |

   Named imports stay the same. Do not rename `WaniwaniChat`, `ChatEmbed`, `ChatHandle`, `ChatTheme` or any other symbol.

   ```tsx
   // Before
   import { WaniwaniChat, type ChatHandle } from "@waniwani/sdk/chat";
   import "@waniwani/sdk/chat/styles.css";

   // After
   import { WaniwaniChat, type ChatHandle } from "@waniwani/chat";
   import "@waniwani/chat/styles.css";
   ```

   ```html
   <!-- Before -->
   <script
     src="https://cdn.jsdelivr.net/npm/@waniwani/sdk@0.25.3/dist/chat/embed.js"
     data-token="wwp_..."
     data-channel-id="..."
   ></script>

   <!-- After -->
   <script
     src="https://app.waniwani.ai/embed.js"
     data-token="wwp_..."
     data-channel-id="..."
   ></script>
   ```

5. **Drop `@waniwani/sdk` when only the chat used it.** Run `rg -n "@waniwani/sdk" --glob '!node_modules' --glob '!*.lock' --glob '!package-lock.json'`. When the only hit left is the `package.json` dependency line, remove the dependency:
   ```bash
   bun remove @waniwani/sdk
   ```
   Then remove `@ai-sdk/mcp` the same way if nothing imports it (`rg -n "@ai-sdk/mcp" --glob '!node_modules'`).
6. **Verify, which is the completion check.**
   ```bash
   bun run typecheck && bun test
   ```
   When the project builds a web app (Next.js, Vite), run its build too. A stylesheet path that does not resolve fails there, not in `tsc`.
7. **Report** each file you rewrote, whether you installed `@waniwani/chat`, and whether you removed `@waniwani/sdk` or `@ai-sdk/mcp`.

## Common mistakes

- **Keeping the old path and skipping the install.** `@waniwani/sdk/chat` still works in 0.26 and 0.27, but only with `@waniwani/chat` installed, and 0.28.0 removes it. Rewrite the imports now.
- **Keeping `chat/` in a `dist` path.** The embed sits at `@waniwani/chat/dist/embed.js`, not `@waniwani/chat/dist/chat/embed.js`.
- **Pinning the embed to a CDN version.** A pinned `cdn.jsdelivr.net` URL never gets fixes. The dashboard snippet loads the current release through `app.waniwani.ai/embed.js`.
- **Removing `@waniwani/sdk` while server code still imports it.** Flows, tracking, `withWaniwani` and `useWaniwani` stay in `@waniwani/sdk`. Remove it only when step 5 finds no import left.
- **Skipping the verify step.** A clean `bun run typecheck` plus green `bun test` is the definition of done, and a web app also needs a green build.
