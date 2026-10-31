# Waniwani SDK

This repo holds the packages for [app.waniwani.ai](https://app.waniwani.ai). It is a bun workspace.

| Package | npm | What it is |
| --- | --- | --- |
| [`packages/sdk`](packages/sdk) | [`@waniwani/sdk`](https://www.npmjs.com/package/@waniwani/sdk) | The open-source flow engine for MCP servers, plus the hosted tracking, knowledge base and documents clients. |
| [`packages/chat`](packages/chat) | [`@waniwani/chat`](https://www.npmjs.com/package/@waniwani/chat) | The chat widget: the React components and `embed.js`. |
| [`packages/protocol`](packages/protocol) | not published | The wire contract both packages share. Their builds inline it. |

Docs live at [docs.waniwani.ai](https://docs.waniwani.ai).

## Develop

```bash
bun install
bun run build      # chat first, then the SDK
bun run typecheck
bun run lint
bun test
```

Each published package has its own version and release. To cut one, run the release script in that package's folder. It bumps the version, commits, tags and pushes, and the tag push publishes the package to npm:

```bash
cd packages/sdk && bun run release:minor    # tag v0.26.0
cd packages/chat && bun run release:patch   # tag chat-v0.26.1
```
