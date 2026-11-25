---
"@waniwani/chat": patch
---

The chat sends every turn through its `api` route (`https://app.waniwani.ai/api/mcp/chat` by default) and never connects to the agent runtime directly. A page's Content-Security-Policy only needs the app's origin in `connect-src`: `https://app.waniwani.ai`, or the EU app's origin for an EU org. The `sessionApi` prop on `WaniwaniChat` is deprecated and ignored, and goes away in 2.0.0.
