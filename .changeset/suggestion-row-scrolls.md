---
"@waniwani/chat": minor
---

The suggestion row is now one line of pills that scrolls sideways, on every surface: the floating dock, the composer, the inline embed and `ChatEmbed`. Each pill shows its full label up to the width of the input, so a long follow-up no longer wraps inside its pill, and six pills no longer cover half a phone screen. An edge fades while pills are scrolled past it, the mouse wheel scrolls the row on desktop, and the row snaps to each pill on touch screens. Clicking a pill still sends it.

`suggestionsLayout` (`data-suggestions-layout` on the script tag, `layout` on `Suggestions`) is deprecated and has no effect; it is removed in 2.0.0. The new `--ww-suggestion-fade` variable sets the width of the edge fade (default `1.75rem`).
