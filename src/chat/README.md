# Chat Module

Embeddable chat widget with theming, Shadow DOM isolation, and event tracking.

## Architecture

```
chat/
├── index.ts                  # Public exports
├── @types.ts                 # ChatWidgetProps, ChatTheme, ChatEmbedConfig
├── theme.ts                  # Default theme + CSS variable generation
├── styles.ts                 # Global stylesheet (animations, scrollbar)
├── icons.tsx                 # SVG icons (SendIcon, ToolIcon)
├── embed/
│   └── embed.ts              # Script-tag embed with Shadow DOM + auto-init
├── hooks/
│   └── use-chat-tracking.ts  # Tracks chat.opened, chat.message_sent, chat.response_received
└── components/
    ├── chat-widget.tsx        # Root component (useChat, transport, theme, tracking)
    ├── chat-panel.tsx         # Layout shell (header + messages + input)
    ├── chat-header.tsx        # Title bar with optional subtitle
    ├── chat-input.tsx         # Auto-resizing textarea + send button
    ├── chat-messages.tsx      # Scrollable message list + typing indicator
    ├── chat-message.tsx       # Message bubble (user/assistant) + tool invocations
    └── chat-markdown.tsx      # Zero-dep markdown renderer (bold, italic, code, links, lists)
```

## Usage

### React component

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

### Embed script

```html
<script
  src="https://cdn.waniwani.ai/chat/embed.js"
  data-api-key="ww_..."
  data-title="Support"
  data-welcome-message="Hi! How can I help?"
></script>
```

Or initialize programmatically:

```js
const chat = window.WaniWani.chat.init({
  apiKey: "ww_...",
  title: "Support",
  container: document.getElementById("chat-container"),
});

// Cleanup
chat.destroy();
```

## Theming

Pass a `theme` object to override any of the defaults:

| Property              | CSS Variable          | Default     |
| --------------------- | --------------------- | ----------- |
| `primaryColor`        | `--ww-primary`        | `#6366f1`   |
| `primaryForeground`   | `--ww-primary-fg`     | `#ffffff`   |
| `backgroundColor`     | `--ww-bg`             | `#ffffff`   |
| `textColor`           | `--ww-text`           | `#1a1a1a`   |
| `mutedColor`          | `--ww-muted`          | `#6b7280`   |
| `borderColor`         | `--ww-border`         | `#e5e7eb`   |
| `assistantBubbleColor`| `--ww-assistant-bg`   | `#f3f4f6`   |
| `userBubbleColor`     | `--ww-user-bg`        | (primary)   |
| `inputBackgroundColor`| `--ww-input-bg`       | `#f9fafb`   |
| `borderRadius`        | `--ww-radius`         | `16px`      |
| `messageBorderRadius` | `--ww-msg-radius`     | `16px`      |
| `fontFamily`          | `--ww-font`           | system stack |

## Data flow

1. `ChatWidget` creates a `DefaultChatTransport` (from `ai` SDK) pointed at the chat API
2. `useChat` manages message state and streaming
3. User input → `sendMessage()` → API → streamed response → rendered as markdown
4. Tool invocations appear inline with a pulse animation while running
5. `useChatTracking` fires analytics events silently in the background

## Embed isolation

The embed script (`embed/embed.ts`) uses **Shadow DOM** for full CSS isolation:
- Host `<div>` appended to the target container (or `document.body`)
- Stylesheet injected inside the shadow root
- All CSS scoped via `.ww-` prefixed classes and `--ww-` CSS variables
- No styles leak in or out
