---
"@waniwani/chat": minor
---

The chat can show its own text for a tool call instead of the tool's name. Set `toolLabels` (a map of tool name to text) on `WaniwaniChat`, `ChatEmbed` or the embed config, or let the channel's `/config` response send it. A tool with no entry keeps its title, or its name in words, as before.
