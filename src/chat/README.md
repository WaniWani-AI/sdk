# Chat Module

Embeddable chat widget built with Tailwind CSS, composable AI elements, and streaming markdown.

## Architecture

```
chat/
├── index.ts                  # Public exports (ChatWidget, ChatTheme, ChatWidgetProps, theme utils)
├── @types.ts                 # ChatWidgetProps, ChatTheme interfaces
├── theme.ts                  # Default theme + CSS variable generation
├── tailwind.css              # Tailwind theme mapping (--ww-* vars → Tailwind tokens)
├── lib/
│   └── utils.ts              # cn() helper (clsx + tailwind-merge)
├── ui/
│   └── button.tsx            # Base Button component (default, outline, ghost variants)
├── ai-elements/
│   ├── conversation.tsx      # Scrollable message container (use-stick-to-bottom)
│   ├── loader.tsx            # Bouncing dots typing indicator
│   ├── message.tsx           # Message bubble (user/assistant) + Streamdown markdown renderer
│   └── prompt-input.tsx      # Composable input (textarea, submit, attachments, drag & drop)
└── components/
    └── chat-widget.tsx       # Root component (useChat, transport, theme, layout)
```

## Usage

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
  allowAttachments
  onMessageSent={(msg) => console.log(msg)}
/>
```

### Props

| Prop                 | Type                          | Default                              |
| -------------------- | ----------------------------- | ------------------------------------ |
| `apiKey`             | `string`                      | —                                    |
| `api`                | `string`                      | `https://app.waniwani.ai/api/chat`   |
| `title`              | `string`                      | `"Chat"`                             |
| `subtitle`           | `string`                      | —                                    |
| `welcomeMessage`     | `string`                      | —                                    |
| `theme`              | `ChatTheme`                   | see Theming                          |
| `headers`            | `Record<string, string>`      | —                                    |
| `body`               | `Record<string, unknown>`     | —                                    |
| `width`              | `number`                      | `400`                                |
| `height`             | `number`                      | `600`                                |
| `allowAttachments`   | `boolean`                     | `false`                              |
| `onMessageSent`      | `(message: string) => void`   | —                                    |
| `onResponseReceived` | `() => void`                  | —                                    |

## Theming

Pass a `theme` object to override any of the defaults:

| Property              | CSS Variable             | Default      |
| --------------------- | ------------------------ | ------------ |
| `primaryColor`        | `--ww-primary`           | `#6366f1`    |
| `primaryForeground`   | `--ww-primary-fg`        | `#ffffff`    |
| `backgroundColor`     | `--ww-bg`                | `#ffffff`    |
| `textColor`           | `--ww-text`              | `#1f2937`    |
| `mutedColor`          | `--ww-muted`             | `#6b7280`    |
| `borderColor`         | `--ww-border`            | `#e5e7eb`    |
| `assistantBubbleColor`| `--ww-assistant-bubble`  | `#f3f4f6`    |
| `userBubbleColor`     | `--ww-user-bubble`       | `#6366f1`    |
| `inputBackgroundColor`| `--ww-input-bg`          | `#f9fafb`    |
| `borderRadius`        | `--ww-radius`            | `16px`       |
| `messageBorderRadius` | `--ww-msg-radius`        | `12px`       |
| `fontFamily`          | `--ww-font`              | system stack |

CSS variables are bridged to Tailwind tokens via `tailwind.css`, so all components use standard Tailwind classes (e.g. `bg-primary`, `text-foreground`) that resolve to the `--ww-*` values at runtime.

## Data flow

1. `ChatWidget` creates a `DefaultChatTransport` (from `ai` SDK) pointed at the chat API
2. `useChat` (from `@ai-sdk/react`) manages message state and streaming
3. User input → `sendMessage()` → API → streamed response → rendered via `Streamdown` markdown
4. Tool invocations appear inline with status labels while running
5. `Conversation` (powered by `use-stick-to-bottom`) auto-scrolls to new messages
6. `PromptInput` supports file attachments via file picker, paste, and global drag & drop
