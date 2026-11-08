# @waniwani/chat

## 1.1.0

### Minor Changes

- [#185](https://github.com/WaniWani-AI/sdk/pull/185) [`0225f57`](https://github.com/WaniWani-AI/sdk/commit/0225f57adacf8d216a7346ec421c0b4fcb4e1e4e) Thanks [@maximeantoine1997](https://github.com/maximeantoine1997)! - The chat is built and tested on AI SDK 7 (`ai` 7, `@ai-sdk/react` 4), and keeps working on AI SDK 6 (`ai` 6.0.141 and later, `@ai-sdk/react` 3). The peer ranges stay the same, so you upgrade with no code change, whichever major your app runs.
  
  - On AI SDK 6, an answer from an AI SDK 7 server now renders. The chat strips the fields AI SDK 6 rejects (`toolMetadata` on MCP tool calls, `citations`, `inputEncoding`, the `interrupted` finish reason) and skips the chunk types it has no schema for (`custom`, `reset-step`, `reasoning-file`, `steering-message`, `tool-approval-response`). Before, a tool call that carried `toolMetadata` failed the whole answer.
  - On AI SDK 7, the message list ignores `custom`, `reasoning-file`, `steering-message` and other part types it does not draw, and still renders the text and the MCP App widgets around them.
  - A page tool call (`onToolCall`) that returns a function, or an object with a function inside, now sends an error result on `@ai-sdk/react` 4 too, as it already did on version 3.
  - `embed.js` carries AI SDK 7 and streams, renders tool calls and renders MCP App widgets against AI SDK 6 and AI SDK 7 servers. It grows by about 20 KB.
