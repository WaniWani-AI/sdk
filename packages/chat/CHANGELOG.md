# @waniwani/chat

## 1.6.1

### Patch Changes

- [#219](https://github.com/WaniWani-AI/sdk/pull/219) [`ff8b8ce`](https://github.com/WaniWani-AI/sdk/commit/ff8b8ceab4aa0ee06ee3c614efc74b1be770b33b) Thanks [@maximeantoine1997](https://github.com/maximeantoine1997)! - The chat sends every turn through its `api` route (`https://app.waniwani.ai/api/mcp/chat` by default) and never connects to the agent runtime directly. A page's Content-Security-Policy only needs the app's origin in `connect-src`: `https://app.waniwani.ai`, or the EU app's origin for an EU org. The `sessionApi` prop on `WaniwaniChat` is deprecated and ignored, and goes away in 2.0.0.

- [#217](https://github.com/WaniWani-AI/sdk/pull/217) [`5cf6a46`](https://github.com/WaniWani-AI/sdk/commit/5cf6a469c1bd2c91a3507b59da37632a4ebf6de6) Thanks [@maximeantoine1997](https://github.com/maximeantoine1997)! - On a touch device, Cmd or Ctrl + Enter now sends the message from the composer and the chat input. Return alone still adds a line there, so a tablet with a hardware keyboard can send without the send button.

## 1.6.0

### Minor Changes

- [#215](https://github.com/WaniWani-AI/sdk/pull/215) [`fb08dc8`](https://github.com/WaniWani-AI/sdk/commit/fb08dc8e6240458c6cd19cd6b50b2e0316951b0b) Thanks [@maximeantoine1997](https://github.com/maximeantoine1997)! - The composer (`mode: "composer"`) now plays an entrance when it comes on screen: it rises into place on the floating bar's curve, the `glow` variant runs its border sweep at the same moment, and the suggestion pills fade in one by one after it. A composer below the fold waits until the visitor scrolls to it, and plays the entrance once. With reduced motion the composer appears at once. Nothing to change in your config.

- [#213](https://github.com/WaniWani-AI/sdk/pull/213) [`98c13f9`](https://github.com/WaniWani-AI/sdk/commit/98c13f95e701ee64076492cddfe04b24f885b88d) Thanks [@reztin](https://github.com/reztin)! - The chat can show its own text for a tool call instead of the tool's name. Set `toolLabels` (a map of tool name to text) on `WaniwaniChat`, `ChatEmbed` or the embed config, or let the channel's `/config` response send it. A tool with no entry keeps its title, or its name in words, as before.

### Patch Changes

- [#216](https://github.com/WaniWani-AI/sdk/pull/216) [`734ed9f`](https://github.com/WaniWani-AI/sdk/commit/734ed9fed54874d622902e1f10c0030e991bafc7) Thanks [@pancakeInDev](https://github.com/pancakeInDev)! - The chat talks straight to the agent runtime again. The runtime moved to a newer message stream format that the bundled client refused, so every message went through the chat route instead, the `waniwani-session` key was never written, and on a channel without thread history a conversation did not reopen after a reload. Nothing to change in existing code: a page that loads `embed.js` through the platform's loader gets the fix on its own.

## 1.5.0

### Minor Changes

- [#207](https://github.com/WaniWani-AI/sdk/pull/207) [`7975faf`](https://github.com/WaniWani-AI/sdk/commit/7975faf098d46b4e40fb62c5e7409741c72c4a87) Thanks [@maximeantoine1997](https://github.com/maximeantoine1997)! - The chat keeps less in the browser, under fixed names, and nothing lives longer than 13 months. The browser keys are `waniwani-visitor-id` (localStorage, 13 months from creation), `waniwani-session` (the chat conversation and the browsing agent's flow session) and `waniwani-config` (sessionStorage, deleted when the tab closes), and the IndexedDB database `waniwani-threads`, which the chat creates only when thread history is on and from which it deletes threads 13 months old. A saved conversation reopens after a reload in the same tab, and a new tab starts a new one. The chat no longer sends `memoryUserId` (in `extra` or in `visitor.client`): an MCP server that needs the anonymous visitor reads `_meta["waniwani/visitorId"]`, and should not treat it as proof of identity. On load the chat deletes the keys older releases wrote (`waniwani-memory-user-id`, `waniwani:eve-conversation:*`, `waniwani:config:*`, `waniwani:webmcp:session` and the `waniwani-memory` database); local thread history saved by older releases is not carried over.

## 1.4.2

### Patch Changes

- [#208](https://github.com/WaniWani-AI/sdk/pull/208) [`9680549`](https://github.com/WaniWani-AI/sdk/commit/9680549d6dc3b553e50609e655c8e94ad32ca6b5) Thanks [@claude](https://github.com/apps/claude)! - `dist/embed.js` ships without a source map. Sites that load the embed from jsDelivr no longer point browsers at `embed.js.map`, which carried the chat's full source. Nothing changes for you: the embed tag stays the same, and the React entry (`@waniwani/chat`) keeps its maps for your own bundler.

## 1.4.1

### Patch Changes

- [#204](https://github.com/WaniWani-AI/sdk/pull/204) [`eb61901`](https://github.com/WaniWani-AI/sdk/commit/eb61901c300666e65d3e70b8c2688e45960e0183) Thanks [@maximeantoine1997](https://github.com/maximeantoine1997)! - On iPhones, the chat panel's background now runs under the keyboard, so the host page no longer shows through the translucent iOS 26 keyboard and Safari's address bar. Tapping the input no longer makes the panel jump while the keyboard opens, and when the keyboard closes the composer slides straight back down instead of waiting for iOS to report the new viewport. While the keyboard is up, the line under the composer (powered-by and AI disclaimer) is hidden; it comes back as the keyboard closes. Nothing to change in existing code.

## 1.4.0

### Minor Changes

- [#199](https://github.com/WaniWani-AI/sdk/pull/199) [`006ae0d`](https://github.com/WaniWani-AI/sdk/commit/006ae0d7a47eb4fcaa23ad5cf80d49ce6591279a) Thanks [@maximeantoine1997](https://github.com/maximeantoine1997)! - The chat panel feels native on phones. Nothing to change in existing code.
  
  - The full-screen panel fills the space above the soft keyboard and follows it, so the header and input stay in view, and the page behind it no longer scrolls.
  - The panel slides up on phones, and the keyboard stays up when a tap opens it.
  - A streaming answer no longer fights the visitor's scroll. Scroll up to read and the thread stays put; scroll back down and it follows again.
  - On a touch keyboard, Return adds a line and the send button sends.
  - Controls dim when pressed, small buttons get a 44px touch area, the dock clears the iPhone home indicator, and the hover styles of a few buttons now apply.

- [#202](https://github.com/WaniWani-AI/sdk/pull/202) [`e926d0c`](https://github.com/WaniWani-AI/sdk/commit/e926d0cceebe92e495282b7017e747663c8d11f9) Thanks [@pancakeInDev](https://github.com/pancakeInDev)! - `data-panel-dockable="true"` adds a header button that lets the visitor move the open panel between the centered modal and the right-hand sidebar; `data-panel-layout` is where it starts. Off by default, so nothing changes without the attribute. New wording keys `launcher.toSidebar` and `launcher.toModal`, new part `ww-layout-toggle`, new `onEvent` event `panel.layout.changed`.

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
