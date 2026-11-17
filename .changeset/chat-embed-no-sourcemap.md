---
"@waniwani/chat": patch
---

`dist/embed.js` ships without a source map. Sites that load the embed from jsDelivr no longer point browsers at `embed.js.map`, which carried the chat's full source. Nothing changes for you: the embed tag stays the same, and the React entry (`@waniwani/chat`) keeps its maps for your own bundler.
