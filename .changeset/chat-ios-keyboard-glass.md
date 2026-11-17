---
"@waniwani/chat": patch
---

On iPhones, the chat panel's background now runs under the keyboard, so the host page no longer shows through the translucent iOS 26 keyboard and Safari's address bar. Tapping the input no longer makes the panel jump while the keyboard opens, and when the keyboard closes the composer slides straight back down instead of waiting for iOS to report the new viewport. While the keyboard is up, the line under the composer (powered-by and AI disclaimer) is hidden; it comes back as the keyboard closes. Nothing to change in existing code.
