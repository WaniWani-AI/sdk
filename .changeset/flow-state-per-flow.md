---
"@waniwani/sdk": minor
---

Each flow in a session now keeps its own state. The store key was the session id alone, so a session that started a second flow loaded the first flow's record: the second flow skipped its intro, resumed at the first flow's step and then overwrote that record. The key is now `flow:<flowId>:<sessionId>`.

A flow that is mid-conversation when you deploy this version finds no state on its next `continue` and starts again from the beginning. Code that reads a flow's record from the store directly reads it under the new key.
