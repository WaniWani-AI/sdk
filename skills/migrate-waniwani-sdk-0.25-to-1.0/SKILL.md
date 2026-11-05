---
name: migrate-waniwani-sdk-0.25-to-1.0
description: "Migrate a project from @waniwani/sdk 0.25.x to 1.0.x. 1.0 removes the chat widget from @waniwani/sdk. The chat ships only in its own package, @waniwani/chat: `@waniwani/sdk/chat` imports become `@waniwani/chat`, `@waniwani/sdk/chat/styles.css` becomes `@waniwani/chat/styles.css`, and a self-hosted `@waniwani/sdk/dist/chat/embed.js` becomes `@waniwani/chat/dist/embed.js`. Trigger when the user is on 0.25.x and wants 1.0, or after bumping sees `Cannot find module '@waniwani/sdk/chat'`, `Missing \"./chat\" specifier in \"@waniwani/sdk\" package`, `Package subpath './chat' is not defined by \"exports\"`, `Package path ./chat is not exported from package`, or the browser console warning `@waniwani/sdk/dist/chat/embed.js is deprecated`."
metadata:
  author: Waniwani
---

# Migrate `@waniwani/sdk` 0.25 → 1.0

A self-contained migration for the hop to `1.0.x`. For other version boundaries use the matching `migrate-waniwani-sdk-<from>-to-<to>` skill, or the general procedure in the SDK's [changelog](https://docs.waniwani.ai/sdk/changelog).

**Precondition:** the project is on `@waniwani/sdk@0.25.x`. On an older version, migrate up to 0.25 first.

A project that never uses the chat widget has nothing to migrate. Bump the dependency, run the completion check, and stop. Step 2 below tells you which case you are in.

## What 1.0 changes

`@waniwani/sdk` 1.0 contains no chat code. The chat widget (`WaniwaniChat`, `ChatEmbed`, the themes, `styles.css` and `embed.js`) ships only in `@waniwani/chat`, which is also at 1.0. `@waniwani/sdk` keeps the server side: flows, the KV stores, tracking, the knowledge base, documents, `withWaniwani` and `useWaniwani`. An MCP server that only uses `createFlow` now installs 0.9 MB instead of 32 MB.

`@waniwani/chat` exports the same 31 names that `@waniwani/sdk/chat` exported in 0.25, with the same types and the same behavior. Only the import path moves.

From 1.0, both packages follow semver. A minor or a patch release does not break the public API.

| 0.25 path | 1.0 path | What the 0.25 path does in 1.0 |
| --- | --- | --- |
| `@waniwani/sdk/chat` | `@waniwani/chat` | Removed. The build fails |
| `@waniwani/sdk/chat/styles.css` | `@waniwani/chat/styles.css` | Removed. The build fails |
| `@waniwani/sdk/chat/embed.js`, `node_modules/@waniwani/sdk/dist/chat/embed.js` | `@waniwani/chat/embed.js`, `node_modules/@waniwani/chat/dist/embed.js` | A forwarder that loads `@waniwani/chat@1` from jsDelivr and logs a deprecation warning. 2.0.0 removes it |
| `cdn.jsdelivr.net/npm/@waniwani/sdk@latest/dist/chat/embed.js` (or `@1`, `@1.x`) | The dashboard snippet, which loads `https://app.waniwani.ai/embed.js` (EU: `https://eu.app.waniwani.ai/embed.js`) | The same forwarder |
| `cdn.jsdelivr.net/npm/@waniwani/sdk@0.<x>.<y>/dist/chat/embed.js` | The dashboard snippet | Nothing changes. A pinned 0.x URL keeps its old bundle and never gets fixes |

Breaking, and visible to the build: every `@waniwani/sdk/chat` import and the `@waniwani/sdk/chat/styles.css` path. `tsc` or the bundler stops with one of the errors named in this skill's description.

Not breaking:

- **Script-tag sites that use the dashboard snippet.** The snippet loads `app.waniwani.ai/embed.js`, a loader that picks the current chat bundle. Nothing on the page changes.
- **Script tags on the old CDN path.** The forwarder adds a script tag for `https://cdn.jsdelivr.net/npm/@waniwani/chat@1/dist/embed.js` with the same `data-*` attributes, so the chat keeps loading. It costs one more request and logs a warning in the browser console. Move these tags to the dashboard snippet now (step 4).
- **`@ai-sdk/mcp`.** `@waniwani/sdk` no longer lists it as an optional peer. Nothing in the SDK imported it. A project that installed it only for the SDK can remove it.
- **Peer dependencies of the chat.** `@waniwani/chat` needs `react`, `ai`, `@ai-sdk/react` and `zod`, the same packages the chat needed inside `@waniwani/sdk`. npm 7 and later, pnpm and bun install missing peers.
- **Tracking.** `createFrontendClient`, `EVENT_TYPES` and `useWaniwani` stay in `@waniwani/sdk`. The chat's `track` and `identify` keep the same shape.

## Procedure

1. **Bump the SDK.** Use the project's package manager (bun shown).
   ```bash
   bun add @waniwani/sdk@^1.0.0
   ```
2. **Collect the chat call sites.**
   ```bash
   rg -n "@waniwani/sdk/chat|@waniwani/sdk/dist/chat|@waniwani/sdk@[^/\"' ]*/dist/chat" --glob '!node_modules' --glob '!*.lock' --glob '!package-lock.json'
   rg -n "@waniwani/sdk" -g 'next.config.*' -g 'vite.config.*' -g 'jest.config.*' -g 'vitest.config.*' -g 'tsconfig*.json'
   ```
   No hit in the first command: the project does not use the chat. Skip to step 6.
3. **Install the chat.**
   ```bash
   bun add @waniwani/chat@^1.0.0
   ```
4. **Rewrite every hit** with the rules below. Each one is a plain text replacement.

   | Match | Replace with |
   | --- | --- |
   | `"@waniwani/sdk/chat"` in an `import`, `export … from`, `import()`, `require()`, `vi.mock()`, `jest.mock()` or `mock.module()` | `"@waniwani/chat"` |
   | `@waniwani/sdk/chat/styles.css` in a JS import or a CSS `@import` | `@waniwani/chat/styles.css` |
   | `@waniwani/sdk/chat/embed.js` | `@waniwani/chat/embed.js` |
   | `@waniwani/sdk/dist/chat/embed.js`, for example in a copy step or a static route | `@waniwani/chat/dist/embed.js` (the `chat/` folder is gone from the path) |
   | `"@waniwani/sdk"` in `transpilePackages`, `optimizePackageImports`, `serverExternalPackages`, a Jest `moduleNameMapper` or a `tsconfig` `paths` entry that exists for the chat | Add `"@waniwani/chat"` next to it. Keep `"@waniwani/sdk"` when other code still imports it |
   | A `<script src>` with `cdn.jsdelivr.net/npm/@waniwani/sdk@…/dist/chat/embed.js` and a `data-token` | `https://app.waniwani.ai/embed.js`, or `https://eu.app.waniwani.ai/embed.js` for an EU project. Keep every `data-*` attribute as it is |
   | The same tag with no `data-token`, which the page starts with `window.WaniWani.chat.init()` | `https://cdn.jsdelivr.net/npm/@waniwani/chat@1/dist/embed.js`. Keep every `data-*` attribute as it is |

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
     src="https://cdn.jsdelivr.net/npm/@waniwani/sdk@latest/dist/chat/embed.js"
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

- **Installing `@waniwani/chat` and keeping the old import path.** 1.0 has no `@waniwani/sdk/chat` entry. The build fails until every import names `@waniwani/chat`.
- **Keeping `chat/` in a `dist` path.** The embed sits at `@waniwani/chat/dist/embed.js`, not `@waniwani/chat/dist/chat/embed.js`.
- **Copying the forwarder.** A copy step that still reads `@waniwani/sdk/dist/chat/embed.js` now copies a 600-byte forwarder, which loads the chat from jsDelivr. A page whose Content Security Policy blocks `cdn.jsdelivr.net` then shows no chat. Copy `@waniwani/chat/dist/embed.js`.
- **Leaving script tags on the old CDN path.** They keep working through the forwarder in every 1.x release, and 2.0.0 removes it. Move them to the dashboard snippet now.
- **Moving an `init()` tag to the loader.** `app.waniwani.ai/embed.js` adds the chat's script tag at run time, and that script can run after `DOMContentLoaded`. A page that calls `window.WaniWani.chat.init()` on `DOMContentLoaded` then finds no `window.WaniWani`. Load `@waniwani/chat@1` straight from jsDelivr for a tag without `data-token`.
- **Pinning the embed to a CDN version.** A pinned `cdn.jsdelivr.net` URL never gets fixes. The dashboard snippet loads the current release through `app.waniwani.ai/embed.js`.
- **Removing `@waniwani/sdk` while server code still imports it.** Flows, tracking, `withWaniwani` and `useWaniwani` stay in `@waniwani/sdk`. Remove it only when step 5 finds no import left.
- **Skipping the verify step.** A clean `bun run typecheck` plus green `bun test` is the definition of done, and a web app also needs a green build.
