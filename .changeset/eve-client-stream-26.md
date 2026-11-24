---
"@waniwani/chat": patch
---

The chat talks straight to the agent runtime again. The runtime moved to a newer message stream format that the bundled client refused, so every message went through the chat route instead, the `waniwani-session` key was never written, and on a channel without thread history a conversation did not reopen after a reload. Nothing to change in existing code: a page that loads `embed.js` through the platform's loader gets the fix on its own.
