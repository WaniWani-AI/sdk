# Chat Widget (`@waniwani/sdk/chat`)

Embeddable chat widget with theming, Shadow DOM isolation, and event tracking.

## Export Path

```
@waniwani/sdk/chat
```

Peer dependencies: `react`, `react-dom`, `@ai-sdk/react`, `ai`

## Exports

| Export | Type | Description |
|--------|------|-------------|
| `ChatWidget` | React component | Main chat widget component |
| `ChatTheme` | TypeScript type | Theme customization interface |
| `ChatWidgetProps` | TypeScript type | Props for `ChatWidget` |
| `ChatEmbedConfig` | TypeScript type | Config for embed script `init()` |
| `DEFAULT_THEME` | Object | Default theme values |
| `mergeTheme` | Function | Merges user theme with defaults |
| `themeToCSSProperties` | Function | Converts theme to CSS custom properties |

## React Component

```tsx
import { ChatWidget } from "@waniwani/sdk/chat";

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

### `ChatWidgetProps`

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

## Embed Script

For non-React sites. Uses Shadow DOM for full CSS isolation.

### Via script tag

```html
<script
  src="https://cdn.waniwani.ai/chat/embed.js"
  data-api-key="ww_..."
  data-title="Support"
  data-welcome-message="Hi! How can I help?"
  data-primary-color="#6366f1"
></script>
```

### Programmatic init

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

### `ChatEmbedConfig`

Same as `ChatWidgetProps` (without callbacks) plus:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `container` | `HTMLElement` | `document.body` | DOM element to mount into |

## Theming

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

## Event Tracking

When `apiKey` is provided, the widget automatically tracks these events via `useChatTracking`:

| Event | Trigger |
|-------|---------|
| `chat.opened` | Widget mounts |
| `chat.message_sent` | User sends a message |
| `chat.response_received` | Streaming response completes |

Tracking is fire-and-forget — failures never break the chat.

## Architecture

```
src/chat/
├── index.ts                  # Public exports
├── @types.ts                 # ChatWidgetProps, ChatTheme, ChatEmbedConfig
├── theme.ts                  # Default theme + CSS variable generation
├── styles.ts                 # Global stylesheet (animations, scrollbar)
├── icons.tsx                 # SVG icons (SendIcon, ToolIcon)
├── embed/
│   └── embed.ts              # Script-tag embed with Shadow DOM + auto-init
├── hooks/
│   └── use-chat-tracking.ts  # Tracks chat events via WaniWani API
└── components/
    ├── chat-widget.tsx        # Root (useChat transport, theme, tracking)
    ├── chat-panel.tsx         # Layout shell (header + messages + input)
    ├── chat-header.tsx        # Title bar with optional subtitle
    ├── chat-input.tsx         # Auto-resizing textarea + send button
    ├── chat-messages.tsx      # Scrollable message list + typing indicator
    ├── chat-message.tsx       # Message bubble + tool invocations
    └── chat-markdown.tsx      # Zero-dep markdown renderer
```

## Data Flow

1. `ChatWidget` creates a `DefaultChatTransport` (from `ai` SDK) pointed at the chat API
2. `useChat` manages message state and streaming
3. User input → `sendMessage()` → API → streamed response → rendered as markdown
4. Tool invocations appear inline with a pulse animation while running
5. `useChatTracking` fires analytics events silently in the background

## Common Mistakes

- **Wrong import path** — Use `@waniwani/sdk/chat`, not `@waniwani/sdk`
- **Missing peer deps** — Requires `react`, `react-dom`, `@ai-sdk/react`, and `ai`
- **Embed cleanup** — Always call `chat.destroy()` on unmount to prevent memory leaks
- **Shadow DOM** — The embed uses Shadow DOM; external CSS won't affect widget styles (use the `theme` prop instead)
