# Chat Widget (`@waniwani/sdk/chat`)

React component and embed script for adding an AI chat widget to any website, with theming and automatic event tracking.

## React Component

### Import

```tsx
import { ChatWidget } from "@waniwani/sdk/chat";
import "@waniwani/sdk/chat/styles.css";
```

Peer dependencies: `react`, `react-dom`, `@ai-sdk/react`, `ai`

All other dependencies (icons, markdown rendering, scroll utilities, styling helpers) are bundled into the SDK.

### Usage

```tsx
<ChatWidget
  apiKey="ww_..."
  title="Support"
  subtitle="Ask us anything"
  welcomeMessage="Hi! How can I help?"
  width={400}
  height={600}
  theme={{ primaryColor: "#6366f1" }}
  onMessageSent={(msg) => console.log(msg)}
/>
```

### ChatWidgetProps

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `apiKey` | `string` | `undefined` | WaniWani project API key |
| `api` | `string` | `https://app.waniwani.ai/api/chat` | Chat API endpoint URL |
| `welcomeMessage` | `string` | `undefined` | Initial greeting before user types |
| `title` | `string` | `"Chat"` | Header title |
| `subtitle` | `string` | `undefined` | Header subtitle |
| `theme` | `ChatTheme` | `DEFAULT_THEME` | Theme overrides |
| `headers` | `Record<string, string>` | `undefined` | Additional headers for chat API requests |
| `body` | `Record<string, unknown>` | `undefined` | Additional body fields per request |
| `width` | `number` | `400` | Panel width in pixels |
| `height` | `number` | `600` | Panel height in pixels |
| `onMessageSent` | `(message: string) => void` | `undefined` | Callback on message sent |
| `onResponseReceived` | `() => void` | `undefined` | Callback on response received |

### Theming

Pass a `theme` object to override defaults:

| Property | CSS Variable | Default |
|----------|-------------|---------|
| `primaryColor` | `--ww-primary` | `#6366f1` |
| `primaryForeground` | `--ww-primary-fg` | `#ffffff` |
| `backgroundColor` | `--ww-bg` | `#ffffff` |
| `textColor` | `--ww-text` | `#1f2937` |
| `mutedColor` | `--ww-muted` | `#6b7280` |
| `borderColor` | `--ww-border` | `#e5e7eb` |
| `assistantBubbleColor` | `--ww-assistant-bubble` | `#f3f4f6` |
| `userBubbleColor` | `--ww-user-bubble` | (primary) |
| `inputBackgroundColor` | `--ww-input-bg` | `#f9fafb` |
| `borderRadius` | `--ww-radius` | `16px` |
| `messageBorderRadius` | `--ww-msg-radius` | `12px` |
| `fontFamily` | `--ww-font` | system stack |

### Event Tracking

When `apiKey` is provided, the widget automatically tracks these events:

| Event | Trigger |
|-------|---------|
| `chat.opened` | Widget mounts |
| `chat.message_sent` | User sends a message |
| `chat.response_received` | Streaming response completes |

Tracking is fire-and-forget -- failures never break the chat.

## Embed Script (Non-React)

For non-React sites, use the embed script. It renders the same chat widget inside a Shadow DOM for full CSS isolation from the host page.

### Script Tag

```html
<script
  src="https://cdn.waniwani.ai/chat/embed.js"
  data-api-key="ww_..."
  data-title="Support"
  data-welcome-message="Hi! How can I help?"
  data-primary-color="#6366f1"
></script>
```

### Programmatic Init

```js
const chat = window.WaniWani.chat.init({
  apiKey: "ww_...",
  title: "Support",
  container: document.getElementById("chat-container"),
  theme: { primaryColor: "#6366f1" },
});

// Cleanup when done
chat.destroy();
```

### ChatEmbedConfig

Same as `ChatWidgetProps` without callbacks (`onMessageSent`, `onResponseReceived`), plus:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `container` | `HTMLElement` | `document.body` | DOM element to mount into |

## Common Mistakes

- **Wrong import path** -- Use `@waniwani/sdk/chat`, not `@waniwani/sdk`
- **Missing peer deps** -- Requires `react`, `react-dom`, `@ai-sdk/react`, and `ai`. Everything else is bundled -- do NOT add them as peer deps or externals
- **Embed cleanup** -- Always call `chat.destroy()` on unmount to prevent memory leaks
- **Shadow DOM styling** -- The embed uses Shadow DOM; external CSS will not affect widget styles. Use the `theme` prop instead
