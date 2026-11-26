---
"@waniwani/kit": minor
---

`defineApp({ favicon })` takes the app's icon as SVG markup and serves it at `/favicon.svg`, with `/favicon.ico` redirecting to it. An MCP directory reads the icon from the server's origin, and a submission audit flags an origin without one.
