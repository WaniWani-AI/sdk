# @waniwani/cli

[![npm](https://img.shields.io/npm/v/@waniwani/cli.svg)](https://www.npmjs.com/package/@waniwani/cli)
[![license](https://img.shields.io/npm/l/@waniwani/cli.svg)](./LICENSE)

Try any local MCP server in the [Waniwani](https://app.waniwani.ai) playground.
`waniwani` logs you in, links your repo to a Waniwani agent, and runs your dev
server behind a public tunnel so the playground (and ChatGPT or Claude) can call
it. Your server can be built on anything: the MCP TypeScript SDK, Skybridge,
FastMCP behind a Node script, a Next.js route.

```bash
npm i -g @waniwani/cli

waniwani login      # browser OAuth (PKCE); asks US or EU on first run
waniwani connect    # pick an org, pick or create an agent, write waniwani.json
waniwani dev        # run your dev script behind the agent's tunnel, open the playground
```

Node 20 or later.

## Commands

| command | what it does |
|---|---|
| `waniwani login [--region us\|eu] [--no-browser]` | Log in. The session is stored in `~/.config/waniwani/settings.json` (or under `XDG_CONFIG_HOME`), one login for every repo on the machine. A member of several organizations picks one. |
| `waniwani logout` | Forget the session. |
| `waniwani switch [org]` | Act in another organization, named by name, slug or ID, or picked from a list. |
| `waniwani connect` | Pick an organization, then an agent, or create one, and write the link into `waniwani.json`. |
| `waniwani dev [--port n] [--no-connect]` | Run the repo's `dev` script, linked to the agent. |

### `waniwani connect`

Two kinds of agent:

- **Managed.** Waniwani creates a GitHub repo and a Vercel project, wired with
  the API key. A push to the tracked branch deploys it.
- **External.** You host the server. `connect` registers it and shows a
  production API key once, to set as `WANIWANI_API_KEY` where the server runs.

The link goes into `waniwani.json` at the repo root. It holds IDs and nothing
secret, so commit it:

```json
{
  "$schema": "https://docs.waniwani.ai/waniwani.json",
  "orgId": "org_…",
  "projectId": "proj_…",
  "devPort": 3000
}
```

### `waniwani dev`

1. Picks a free port, starting at `devPort` from `waniwani.json` or 3000
   (`--port` sets it exactly).
2. Runs the repo's `dev` script with the package manager its lockfile names
   (`bun`, `pnpm`, `yarn` or `npm`), with the port in `PORT`. Your server has to
   listen on `PORT`.
3. Opens the agent's Cloudflare tunnel on that port, at a stable
   `<slug>.waniwani.dev` hostname.
4. Registers a dev session, which routes your playground chats to the tunnel,
   and opens the playground.

Ctrl-C ends the session and stops the server, and the playground goes back to
the deployed agent. A tunnel that fails to open leaves the local server running
with a warning.

The tunnel runs `cloudflared`. One on `PATH` is used as it is; otherwise the
first `dev` downloads it from Cloudflare's GitHub releases into
`~/.cache/waniwani/bin/`.

`--no-connect` runs the script with no port and no link.

## With @waniwani/kit

[`@waniwani/kit`](https://www.npmjs.com/package/@waniwani/kit) builds an MCP app
from a folder of tools, widgets and flows, and it ships a `waniwani` binary too.
The kit depends on this package, and the two binaries answer the same commands:

- in a kit app (a folder with `waniwani.config.ts`), this package hands `dev`,
  `init`, `check`, `build`, `start` and `eject` to the kit the app installed;
- the kit hands `login`, `logout`, `switch` and `connect` to this package.

So whichever `waniwani` your shell finds does the same thing. A kit app needs
only `@waniwani/kit` in its dependencies. With both packages installed in one
project, the package manager links one of the two binaries, and either is
correct. A global install takes only one of them: npm refuses a second global
package with the same binary name.

## Configuration

| variable | effect |
|---|---|
| `WANIWANI_API_URL` | Talk to another instance for this run, such as a staging deploy. |
| `XDG_CONFIG_HOME` | Where the session file lives (default `~/.config`). |
| `WANIWANI_DEBUG` | Print stack traces. |

The CLI reads `.env.local` and `.env` from the repo root. A repo can pin the US
or the EU instance, with `WANIWANI_API_URL` in one of those files or `apiUrl` in
`waniwani.json`. Any other host from a repo file is ignored with a warning: a
cloned repo should not choose where you log in or where your local server is
exposed. For a staging or local instance, export `WANIWANI_API_URL` in your
shell.

Every request is made with your login. The CLI never sends `WANIWANI_API_KEY`,
which belongs to one agent and is for the SDK's tracking calls.

## License

MIT
