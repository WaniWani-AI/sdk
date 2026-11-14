---
"@waniwani/chat": minor
---

MCP App widgets now render with the AI SDK's `MCPAppRenderer` (`@ai-sdk/react` 4.0.170, built into the chat), behind a sandbox proxy page. `McpAppFrame` keeps its name and props, and the peer ranges stay the same, so AI SDK 6 apps upgrade with no code change.

- Each widget runs in an inner frame with an opaque origin. It can no longer read the host page, the cookies of the site it loads from, or `localStorage`, which throws a `SecurityError`. Skybridge widgets catch that error and keep their view state in memory.
- A widget can call only the tools that are visible to it. A tool whose `_meta.ui.visibility` leaves out `"app"` now answers the widget with an error.
- When the resource carries a CSP in its metadata, the widget runs under that CSP.
- New optional `mcp.sandboxUrl` on `ChatEmbed` (and `sandboxUrl` on `McpAppFrame`): the sandbox proxy page to load widgets behind. Without it, the chat uses a built-in proxy page as a `data:` URL. A page whose CSP limits `frame-src` must allow `data:`, and the chat logs a console warning when the CSP blocks it.
- `mcp.resourceEndpoint` can now answer with JSON `{ uri, html, meta }` as well as with the HTML. The chat fetches it from the page, so a resource endpoint on another origin must allow CORS.
- The frame no longer reloads a widget that does not answer within 3 seconds, and no longer animates its height changes.
- `embed.js` grows by about 11 KB (about 4 KB gzipped).
