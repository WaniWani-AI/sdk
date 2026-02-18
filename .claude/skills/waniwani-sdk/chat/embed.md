# Chat Embed Script (`@waniwani/sdk/chat`)

Embed the chat widget on non-React sites using a script tag or programmatic init. Uses Shadow DOM for full CSS isolation.

## Via script tag

```html
<script
  src="https://cdn.waniwani.ai/chat/embed.js"
  data-api-key="ww_..."
  data-title="Support"
  data-welcome-message="Hi! How can I help?"
  data-primary-color="#6366f1"
></script>
```

## Programmatic init

```js
const chat = window.WaniWani.chat.init({
  apiKey: "ww_...",
  title: "Support",
  container: document.getElementById("chat-container"),
  theme: { primaryColor: "#6366f1" },
});

// Cleanup
chat.destroy();
```

## `ChatEmbedConfig`

Same as `ChatWidgetProps` (see [react.md](react.md)) without callbacks, plus:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `container` | `HTMLElement` | `document.body` | DOM element to mount into |

## Exports

| Export | Type | Description |
|--------|------|-------------|
| `ChatEmbedConfig` | TypeScript type | Config for embed script `init()` |

## Architecture

```
src/chat/
└── embed/
    └── embed.ts    # Script-tag embed with Shadow DOM + auto-init
```

## Common Mistakes

- **Embed cleanup** — Always call `chat.destroy()` on unmount to prevent memory leaks
- **Shadow DOM** — The embed uses Shadow DOM; external CSS won't affect widget styles (use the `theme` prop instead)
