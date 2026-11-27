---
"@waniwani/chat": patch
---

A turn that fails now shows a bubble in the conversation instead of nothing. It covers an HTTP error from the chat route, a request that never reached the server and a reply stream that breaks midway. The bubble has a Retry button that sends the last message again and drops any half-written answer.

On a 429, the bubble reads the `Retry-After` header (seconds or an HTTP date), tells the visitor how long to wait and keeps Retry disabled until then. Without the header it asks them to wait a moment.

The text is in English, French and Spanish and can be overridden like any other string, under the new `turnError` section of `messages`. The bubble carries the `ww-error` class.
