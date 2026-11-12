# @waniwani/chat

## 1.3.0

### Minor Changes

- [#194](https://github.com/WaniWani-AI/sdk/pull/194) [`07663fa`](https://github.com/WaniWani-AI/sdk/commit/07663fa2d5f4cdc0852072d59be7f45de944fe9a) Thanks [@pancakeInDev](https://github.com/pancakeInDev)! - The AI disclaimer under the input can carry a link. Write it as `[label](https://…)` in `data-disclaimer` (script tag) or in the `disclaimer` prop (React), for example `data-disclaimer="AI agent. It can make mistakes. [Learn more](https://example.com/ai-notice)"`. The label renders as a link that opens in a new tab, with the part class `ww-disclaimer-link` for your `data-css` stylesheet. Only `http` and `https` URLs become links; any other text stays as it is. Wordings without a link are unchanged.

### Patch Changes

- [#190](https://github.com/WaniWani-AI/sdk/pull/190) [`1697c92`](https://github.com/WaniWani-AI/sdk/commit/1697c92b06abc742348ef182eb90f39dae120268) Thanks [@andrewdw](https://github.com/andrewdw)! - Fix the `Maximum update depth exceeded` error (React error 185) in the composer when a tool types into it fast, for example a dictation tool or an automation agent. The error also lost some of the typed characters. You do not have to change your code.

## 1.2.1

### Patch Changes

- [#191](https://github.com/WaniWani-AI/sdk/pull/191) [`192af59`](https://github.com/WaniWani-AI/sdk/commit/192af59d8424fada58b9af569a7b5a959f691b45) Thanks [@maximeantoine1997](https://github.com/maximeantoine1997)! - `WaniwaniChat` accepts `overrides.headerActions`: React nodes placed at the right end of the sticky header, in the same row and alignment as the New chat and history buttons. Setting it shows the header; `hideHeader` still hides it.
  
  The header's New chat, history and actions-menu buttons share one 32px square style with a working hover and focus state. New chat uses a compose icon in place of the plus, and the three buttons drop the native browser tooltip; their `aria-label` still names them.

## 1.2.0

### Minor Changes

- [#188](https://github.com/WaniWani-AI/sdk/pull/188) [`a18fcca`](https://github.com/WaniWani-AI/sdk/commit/a18fccae9657de0d9f415983aeee971777fa823a) Thanks [@maximeantoine1997](https://github.com/maximeantoine1997)! - Open the chat in a sidebar. Set `data-panel-layout="sidebar"` (or `panelLayout: "sidebar"` in `WaniWani.chat.init()`) with `data-mode="floating"` or `data-mode="composer"`, and a send from the bar or the box slides a full-height panel in from the right edge of the page. The default stays `modal`. Set the width with `--ww-sidebar-width` (default `440px`). Phones still get the full-screen sheet.

## 1.1.0

### Minor Changes

- [#185](https://github.com/WaniWani-AI/sdk/pull/185) [`0225f57`](https://github.com/WaniWani-AI/sdk/commit/0225f57adacf8d216a7346ec421c0b4fcb4e1e4e) Thanks [@maximeantoine1997](https://github.com/maximeantoine1997)! - The chat is built and tested on AI SDK 7 (`ai` 7, `@ai-sdk/react` 4), and keeps working on AI SDK 6 (`ai` 6.0.141 and later, `@ai-sdk/react` 3). The peer ranges stay the same, so you upgrade with no code change, whichever major your app runs.
  
  - On AI SDK 6, an answer from an AI SDK 7 server now renders. The chat strips the fields AI SDK 6 rejects (`toolMetadata` on MCP tool calls, `citations`, `inputEncoding`, the `interrupted` finish reason) and skips the chunk types it has no schema for (`custom`, `reset-step`, `reasoning-file`, `steering-message`, `tool-approval-response`). Before, a tool call that carried `toolMetadata` failed the whole answer.
  - On AI SDK 7, the message list ignores `custom`, `reasoning-file`, `steering-message` and other part types it does not draw, and still renders the text and the MCP App widgets around them.
  - A page tool call (`onToolCall`) that returns a function, or an object with a function inside, now sends an error result on `@ai-sdk/react` 4 too, as it already did on version 3.
  - `embed.js` carries AI SDK 7 and streams, renders tool calls and renders MCP App widgets against AI SDK 6 and AI SDK 7 servers. It grows by about 20 KB.
