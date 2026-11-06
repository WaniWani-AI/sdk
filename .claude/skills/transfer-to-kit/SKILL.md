---
name: transfer-to-kit
description: Port an existing MCP server repo onto @waniwani/kit, so the repo keeps only tools, widgets, flows and endpoints and the kit owns the server, the bundler and the deploy files. Use when someone asks to transfer, port or migrate an MCP to the kit, to move a hand-written Skybridge repo (server/ + web/ + api/) onto the folder convention, or to get rid of an MCP repo's plumbing.
user-invocable: true
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, AskUserQuestion, TodoWrite
---

# Transfer an MCP onto the kit

A transfer moves a repo's own code into four folders and deletes everything
around it. What comes out imports `@waniwani/kit` and `@waniwani/sdk` and nothing
else: no `McpServer` construction, no transport, no `vite.config.ts`, no
`Dockerfile`, no `vercel.json`, no `api/index.ts` entry.

Read the kit's [README](../../../README.md) for the convention itself. This skill
covers the transfer: what maps where, what has no home, and the five failures
that cost time the first time round.

## 1. Inventory before moving anything

Read the source repo and fill this table in. Do not start moving files until
every row has a destination, because the rows with no destination are the ones
worth a conversation.

| source shape | destination |
|---|---|
| `registerTool(name, config, handler)` | `tools/<name>.ts`, `defineTool({ title, description, input, output, hints, run })` |
| `registerWidget(name, ...)` plus a `web/` component | `widgets/<name>/widget.ts` and `widgets/<name>/ui.tsx` |
| `createFlow(...).compile()` | `flows/<name>.ts`, default-exported |
| `server.use(path, handler)`, or an Express route in `api/` | `api/<path>.ts`, `defineEndpoint({ method, handler })` |
| shared modules, API clients, types | `lib/`, imported relatively |
| `McpServer` name, title, instructions | `waniwani.config.ts`, `defineApp({ name, title, overview })` |
| `server/src/index.ts`, `api/index.ts`, `web/vite.config.ts`, `Dockerfile`, `tsconfig.json` | deleted, the kit owns all of it |
| `vercel.json` | stripped to one key, `"framework": null` (see Deploying) |

Then run these four checks over the source, because each one has a decision
attached:

```bash
# 1. Tools whose name the distribution template already registers.
grep -rn "registerTool\|createTool" --include="*.ts" . | grep -o '"[a-z-]*"' | sort -u
# The template ships `faq`. Two registrations of one name make the MCP SDK throw.

# 2. Anything reading process.env at module scope.
grep -rn "process\.env" --include="*.ts" . | grep -v "handler\|run:"

# 3. Storybook, tests, scripts: files that will be compiled once they land
# under src/app/ and need dependencies the generated project may not carry.
ls .storybook 2>/dev/null; find . -name "*.stories.*" -not -path "./node_modules/*"

# 4. The @waniwani/sdk version the app is on today.
grep -rn '"@waniwani/sdk"' package.json
# The port lands on 0.20. Every minor below it is a migration the transfer
# carries, so this number is the size of the job (see Move the files).
```

Bring these to the user with `AskUserQuestion` before touching the repo:

- **A tool that collides with the template's.** The app's version cannot win.
  Either drop it and accept the template's, or rename it and accept two
  overlapping tools.
- **`withWaniwani` options.** The template calls it with no options and the app
  cannot reach it, so `flushAfterToolCall`, `toolType` and `metadata` are lost.
  Say so rather than dropping them silently: the flush matters on serverless.
- **Storybook.** No home. Confirm dropping it.
- **Where it lands.** A branch in the source repo keeps `main` deployable and
  makes git record the renames.
- **How far the deploy check goes.** Local, or a real deployment.

## 2. Move the files

Work on a branch, and move with `git mv` so the history survives:

```bash
git checkout -b kit-port
mkdir -p lib flows widgets api
git mv server/src/<app>/lib/*.ts lib/
git mv server/src/<app>/flows/<name>/flow.ts flows/<name>.ts   # flows/ is flat
git mv web/src/widgets/<name>.tsx widgets/<name>/ui.tsx
git rm -r server web api/index.ts vercel.json Dockerfile tsconfig.json
```

`api/index.ts` goes and `api/` stays: the folder is the endpoint convention now,
holding one file per path rather than one Express entry for the whole server.

Then, in this order:

**`waniwani.config.ts`.** `name` is the MCP server name from the old
`new McpServer({ name })`. The server's `instructions` come from `overview`, which
reaches the host LLM once in the `initialize` handshake, so a repo that had none is
worth offering one to. Keep it to what the app is and which tool to reach for when;
anything about a single tool belongs in that tool's `description`.

**Widgets split in two.** The old `inputSchema` becomes the widget's `data`, the
one schema serving input, structured output and the component's props. Watch the
boundary: `data` is model-visible, so a field the server used to inject on its
own either moves to `load()` or leaves the schema.

In `ui.tsx`, four things change:

```diff
-import "@/index.css";                          // the generated view imports the template's
-import { mountWidget, useToolInfo } from "skybridge/web";
+import { useWidget } from "@waniwani/kit/web";
+import widget from "./widget.js";
-export function BookCall() {
-  const { output: props } = useToolInfo<{ output: Props }>();
+export default function BookCall() {
+  const { data: props } = useWidget(widget);
-mountWidget(<BookCall />);                     // the framework mounts the default export
```

Keep exactly one default export. A leftover `export default X` at the bottom
alongside `export default function X` fails the build.

**Flows flatten.** `flows/<name>/flow.ts` plus its helpers becomes
`flows/<name>.ts` with the helpers in `lib/`, and the export becomes a default
export. The MCP tool name comes from the flow's `id`, not the filename, so
renaming the file changes nothing the model sees.

**Endpoints.** One file per path, and the path is the file's position:
`api/cal/slots.ts` answers `/api/cal/slots`. Drop the CORS and body-parser
middleware the old Express entry set up, since the runtime supplies both.

**`package.json`.** Down to the app's own dependencies and four scripts:

```json
{
  "type": "module",
  "scripts": {
    "check": "waniwani check",
    "dev": "waniwani dev",
    "build": "waniwani build",
    "start": "waniwani start"
  },
  "dependencies": {
    "@waniwani/kit": "^0.1.4",
    "@waniwani/sdk": "^0.20.0",
    "react": "^19.2.4",
    "react-dom": "^19.2.4",
    "zod": "^4.3.6"
  }
}
```

`@waniwani/kit` needs to be at least 0.1.4 for `api/` to exist. On an earlier
version the folder is copied and never mounted, and nothing says so.

`@waniwani/sdk` at `^0.20.0` is the other floor, and the app being ported is
usually under it. Raising the number is not the migration: each minor in between
changed something the app's own code says, and `Waniwani-AI/sdk` ships one skill
per hop that makes the change. Apply them in order, starting at the hop above the
version the inventory recorded, and finish before the port's first
`waniwani check` — that check imports every server-safe module for real, so an
unmigrated call site comes back as a load failure with the SDK nowhere in the
message.

```bash
bunx skills add Waniwani-AI/sdk -s migrate-waniwani-sdk-0.15-to-0.16
bunx skills add Waniwani-AI/sdk -s migrate-waniwani-sdk-0.16-to-0.17
bunx skills add Waniwani-AI/sdk -s migrate-waniwani-sdk-0.17-to-0.18
bunx skills add Waniwani-AI/sdk -s migrate-waniwani-sdk-0.18-to-0.19
bunx skills add Waniwani-AI/sdk -s migrate-waniwani-sdk-0.19-to-0.20
```

Nothing exists below `0.15-to-0.16`. An app older than 0.15 walks the chain from
there and takes the remainder off the SDK's changelog and types.

Installing a skill writes `skills-lock.json`, and that file belongs to the port:
commit it, so the repo carries a record of which hops it has been through.

The skills cover what each hop renamed or deleted, and one 0.20 change sits
outside them: a flow's store became explicit, so `createFlow(...).compile()` with
no store throws where every version below fell back to a default. Nothing in
`0.19-to-0.20` mentions it. It arrives as dozens of failing unit tests naming
neither the SDK nor the store, and the fix is to pass a store — an in-memory one
keeps check, dev and build running offline while a deploy keeps its hosted
state. Read a ported app's `flows/` for the shape.

So: apply the skills for what they carry, and expect the port to still meet
behaviour they do not describe. A hop reporting no applicable rewrite is a
normal outcome, not a sign the migration was skipped.

## 3. The failures worth knowing in advance

**`.waniwani/settings.json` is `@waniwani/cli`'s login state.** The build output
now owns that directory. Check for the file before the first build and warn the
user: clearing the output directory takes their tokens with it, and
`waniwani login` is the way back.

**A module that reads `process.env` at import time.** The kit loads the app's
`.env` before it spawns anything, so this works from 0.1.4 on. Below that, or
when the variable is genuinely absent, the symptom is a build check failure
rather than a runtime one:

```
✗ Build check failed
  flows/demo-qualification.ts
  └ failed to load
    [waniwani] createFlow "demo_qualification": no flow store configured.
```

Read that as a missing variable, not a missing store. Confirm the `.env` sits
next to `waniwani.config.ts`, and that its name is `.env` rather than
`.env.development`.

**Two default exports in `ui.tsx`.** Covered above, and it is the most common
mechanical slip in the widget move.

**A tool name that duplicates the template's.** The server starts and then dies
on the second registration. `waniwani check` cannot catch this one, because it
never sees what the template registers. Run `tools/list` and compare.

**A `styles.css` anywhere in the app folder.** Nothing imports app CSS. The build
check names the file. Move the rules into utility classes in `ui.tsx`.

## 4. Verify in this order

Each step catches what the one before it cannot.

```bash
bun run check     # structure, then every server-safe module imported for real
bun run build     # server compiled, views bundled, Vercel output emitted
PORT=3321 bun run start
```

Probe the running server with the script next to this file. It lists the tools,
calls each one, reads the widget resource, and exercises every endpoint
including the 405 and 400 paths:

```bash
node .claude/skills/transfer-to-kit/probe.mjs http://localhost:3321
```

Read three things in that output rather than only the exit status:

- the **tool list**, against the old server's. A tool that quietly failed to move
  shows up here and nowhere else.
- the **server version**. `0.0.0` means the app's `package.json` has no version.
- each **endpoint's status**, since a 404 means the file did not become a route.

Then render the widget, because none of the above touches the UI. `bun run dev`
serves the framework's playground at the root: open it, run the widget's tool
with real arguments, and read the console. A widget that fetches its own
endpoints proves the whole chain in one screenshot.

Deploying is a git push. `waniwani build` leaves a Build Output tree at
`.vercel/output`, Vercel's `Other` preset runs the `build` script it finds in
`package.json`, and the tree is adopted as built. So a transfer **replaces the
old `vercel.json` with this, and nothing else**:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": null
}
```

That one key is what a transfer cannot skip. The preset is a project setting
Vercel resolves before the build command runs, and a project created months
before the transfer holds whatever preset it was made with. A `Next.js` preset
fails after the install and never reaches the build:

```
Error: No Next.js version detected.
```

`framework: null` overrides the dashboard, so it fixes an already-created project
without anyone opening it. The old shape is recognisable, and every line of it
points at an entry file the transfer deleted:

```json
{
  "buildCommand": "npm run build:vercel",
  "functions": { "api/index.ts": { ... } },
  "rewrites": [{ "source": "/(.*)", "destination": "/api/index" }]
}
```

Leaving any of that in place is worse than the old server. The `buildCommand`
overrides the one Vercel would pick, so the build runs a script that no longer
exists, and a **Build Command** override in the dashboard does the same damage.
Check it:

```bash
vercel project inspect <project> --scope <team>   # Build Command must be the default
```

Reproduce the hosted build locally before pushing, because it is not the same
build as `waniwani build`:

```bash
vercel build --yes    # needs .vercel/project.json, from `vercel link`
```

Then read the emitted route table, where the one Vercel-specific trap shows up:

```bash
python3 -c "import json;[print(r) for r in json.load(open('.vercel/output/config.json'))['routes']]"
```

`{"src": "/api(/.*)?", "dest": "/mcp"}` has to appear **before**
`{"handle": "filesystem"}`. Vercel compiles every file under a root `api/` into a
serverless function of its own, and those sit in the filesystem phase; the kit
inserts that route ahead of it so `/api/*` reaches the server it built instead.
Without it every endpoint answers a runtime error in production while every local
check passes.

Two more things to expect. A preview URL under Vercel's SSO protection answers
`Protected deployment` to any probe, so verifying one needs a protection bypass
token or a custom domain. And an app whose flow reads `WANIWANI_API_KEY` at
import time will not boot at all in an environment where that variable is
missing, which is the normal state of a preview on a project that sets its
variables for production only.

## 5. Report what the transfer cost

Close by telling the user, in one list, what is no longer there: the tool that
lost to the template's, the `withWaniwani` options, Storybook, and anything the
inventory flagged with no destination. A transfer that reports itself as clean
when a tool description changed is worse than one that names the change.

Name the SDK migration skills the port applied in the same list. They are the
part of the cost that is not a loss, and they say which version the app came
from rather than only which one it landed on — the next person to open the repo
reads that off the report, not off a diff.
