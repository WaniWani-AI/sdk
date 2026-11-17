---
"@waniwani/chat": patch
---

The chat now sends `visitor.idSource` with each request: `customer` when the page set the visitor ID through `visitorId` or `setVisitorId()`, `generated` when the chat made it. Waniwani uses it to send chat events to the right Amplitude user, because an Amplitude device ID and the chat's own visitor ID are both random UUIDs. Nothing changes for your page.
