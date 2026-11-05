# Waniwani SDK

This repo holds the packages for [app.waniwani.ai](https://app.waniwani.ai). It is a bun workspace.

| Package | npm | What it is |
| --- | --- | --- |
| [`packages/sdk`](packages/sdk) | [`@waniwani/sdk`](https://www.npmjs.com/package/@waniwani/sdk) | The open-source flow engine for MCP servers, plus the hosted tracking, knowledge base and documents clients. |
| [`packages/chat`](packages/chat) | [`@waniwani/chat`](https://www.npmjs.com/package/@waniwani/chat) | The chat widget: the React components and `embed.js`. |
| [`packages/core`](packages/core) | not published | The wire contract both packages share. Their builds inline it. |

Docs live at [docs.waniwani.ai](https://docs.waniwani.ai).

## Develop

```bash
bun install
bun run build      # chat first, then the SDK
bun run typecheck
bun run lint
bun test
```

Each published package has its own version, and [Changesets](https://changesets.dev) releases them. A PR that changes a package adds a changeset, which names the package, the semver bump and the changelog line:

```bash
bun changeset
```

Changesets on `main` collect in one "version packages" PR. Merging it publishes the bumped packages to npm. [`.changeset/README.md`](.changeset/README.md) covers the details, including beta snapshots.
