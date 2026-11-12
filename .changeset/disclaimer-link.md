---
"@waniwani/chat": minor
---

The AI disclaimer under the input can carry a link. Write it as `[label](https://…)` in `data-disclaimer` (script tag) or in the `disclaimer` prop (React), for example `data-disclaimer="AI agent. It can make mistakes. [Learn more](https://example.com/ai-notice)"`. The label renders as a link that opens in a new tab, with the part class `ww-disclaimer-link` for your `data-css` stylesheet. Only `http` and `https` URLs become links; any other text stays as it is. Wordings without a link are unchanged.
