---
"@waniwani/chat": patch
---

`WaniwaniChat` accepts `overrides.headerActions`: React nodes placed at the right end of the sticky header, in the same row and alignment as the New chat and history buttons. Setting it shows the header; `hideHeader` still hides it.

The header's New chat, history and actions-menu buttons share one 32px square style with a working hover and focus state. New chat uses a compose icon in place of the plus, and the three buttons drop the native browser tooltip; their `aria-label` still names them.
