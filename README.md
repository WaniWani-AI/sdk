# Waniwani SDK

This repo holds the packages for [app.waniwani.ai](https://app.waniwani.ai). It is a bun workspace.

| Package | npm | What it is |
| --- | --- | --- |
| [`packages/sdk`](packages/sdk) | [`@waniwani/sdk`](https://www.npmjs.com/package/@waniwani/sdk) | The open-source flow engine for MCP servers, plus the hosted tracking, knowledge base and documents clients. |
| [`packages/chat`](packages/chat) | [`@waniwani/chat`](https://www.npmjs.com/package/@waniwani/chat) | The chat widget: the React components and `embed.js`. |
| [`packages/kit`](packages/kit) | [`@waniwani/kit`](https://www.npmjs.com/package/@waniwani/kit) | The `waniwani` CLI and server runtime: an MCP app built from a folder of tools, widgets and flows. |
| [`packages/core`](packages/core) | not published | The wire contract the SDK and the chat share. Their builds inline it. |
| [`packages/kit/examples/oney`](packages/kit/examples/oney) | not published | An example app on the kit. CI generates, serves and ejects it. |

Docs live at [docs.waniwani.ai](https://docs.waniwani.ai).

## Develop

```bash
bun install
bun run build      # chat, then the SDK, then the kit
bun run typecheck  # after build: the kit reads the built types
bun run lint
bun test
bun run contract   # the kit's template contract, slow
```

Each published package has its own version, and [Changesets](https://changesets.dev) releases them. A PR that changes a package adds a changeset, which names the package, the semver bump and the changelog line:

```bash
bun changeset
```

Changesets on `main` collect in one "version packages" PR. Merging it publishes the bumped packages to npm. [`.changeset/README.md`](.changeset/README.md) covers the details, including beta snapshots.
