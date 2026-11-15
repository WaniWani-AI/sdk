---
"@waniwani/chat": minor
---

The chat panel feels native on phones. Nothing to change in existing code.

- The full-screen panel fills the space above the soft keyboard and follows it, so the header and input stay in view, and the page behind it no longer scrolls.
- The panel slides up on phones, and the keyboard stays up when a tap opens it.
- A streaming answer no longer fights the visitor's scroll. Scroll up to read and the thread stays put; scroll back down and it follows again.
- On a touch keyboard, Return adds a line and the send button sends.
- Controls dim when pressed, small buttons get a 44px touch area, the dock clears the iPhone home indicator, and the hover styles of a few buttons now apply.
- New `haptics` option (`data-haptics` on the script embed): a light haptic tick when the visitor sends a message on a touch device. Off by default.
