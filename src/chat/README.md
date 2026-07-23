# Chat Module

Embeddable chat widget built with Tailwind CSS, composable AI elements, and streaming markdown.

## Architecture

```
chat/
├── index.ts                  # Public exports (WaniwaniChat, ChatEmbed, ChatTheme, theme utils)
├── @types.ts                 # ChatBaseProps, ChatEmbedProps, ChatTheme, ChatClassNames
├── theme.ts                  # Default/dark themes + CSS variable generation
├── tailwind.css              # Tailwind theme mapping (--ww-* vars → Tailwind tokens)
├── embed/                    # <script> IIFE embed (embed.js) + config resolution
├── lib/
│   └── utils.ts              # cn() helper (clsx + tailwind-merge, ww prefix)
├── ai-elements/
│   ├── conversation.tsx      # Scrollable message container (use-stick-to-bottom)
│   ├── message.tsx           # Message wrapper + bubble content + Streamdown renderer
│   └── prompt-input.tsx      # Composable input (textarea, submit, attachments)
└── layouts/
    ├── waniwani-chat.tsx     # Hosted-tier chat (recommended)
    └── chat-embed.tsx        # Borderless bring-your-own-backend primitive
```

`ChatCard` is `@deprecated` and lives in `src/legacy/chat/web/chat-card.tsx`.

## Usage

Hosted tier (recommended) — configure the agent in the dashboard, pass a token:

```tsx
import { WaniwaniChat } from "@waniwani/sdk/chat";
import "@waniwani/sdk/chat/styles.css";

<WaniwaniChat
  token="wwp_..."
  channelId="..."
  overrides={{
    appearance: { theme: "light", variables: { primaryColor: "#0a6c74" } },
  }}
/>;
```

Bring-your-own-backend primitive:

```tsx
import { ChatEmbed } from "@waniwani/sdk/chat";

<ChatEmbed
  api="/api/my-chat"
  title="Support"
  welcomeMessage="Hi! How can I help?"
  appearance={{ theme: "light", variables: { primaryColor: "#0a6c74" } }}
  allowAttachments
  onMessageSent={(msg) => console.log(msg)}
/>;
```

## Theming

Styling is token-based. Pass `appearance` — a preset plus per-property `variables` — to the React components, `init({ appearance })` to the `<script>` embed, or set the `--ww-*` custom properties directly in your own CSS. The same shape works everywhere.

```ts
appearance: { theme: "dark", variables: { primaryColor: "#ff6b6b" } }
```

### `appearance.variables` (`ChatTheme`)

| Property | CSS variable | Default (light) |
| --- | --- | --- |
| `primaryColor` | `--ww-primary` | `#6366f1` |
| `primaryForeground` | `--ww-primary-fg` | `#1f2937` |
| `backgroundColor` | `--ww-bg` | `#ffffff` |
| `textColor` | `--ww-text` | `#1f2937` |
| `mutedColor` | `--ww-muted` | `#6b7280` |
| `borderColor` | `--ww-border` | `#e5e7eb` |
| `borderWidth` | `--ww-border-width` | `0` |
| `boxShadow` | `--ww-shadow` | `none` |
| `userBubbleColor` | `--ww-user-bubble` | `#f4f4f4` |
| `userBubbleTextColor` | `--ww-user-bubble-text` | `#1f2937` |
| `assistantBubbleColor` | `--ww-assistant-bubble` | `#f3f4f6` |
| `assistantBubbleTextColor` | `--ww-assistant-bubble-text` | `#1f2937` |
| `inputBackgroundColor` | `--ww-input-bg` | `#f9fafb` |
| `borderRadius` | `--ww-radius` | `16px` |
| `messageBorderRadius` | `--ww-msg-radius` | `8px` |
| `messagePaddingX` | `--ww-msg-pad-x` | `16px` |
| `messagePaddingY` | `--ww-msg-pad-y` | `12px` |
| `messageMaxWidth` | `--ww-msg-max-width` | `80%` |
| `fontFamily` | `--ww-font` | system stack |
| `fontSize` | `--ww-font-size` | `1rem` |
| `lineHeight` | `--ww-line-height` | `1.5` |
| `headerBackgroundColor` | `--ww-header-bg` | `#ffffff` |
| `headerTextColor` | `--ww-header-text` | `#1f2937` |
| `statusColor` | `--ww-status` | `#22c55e` |
| `toolCardColor` | `--ww-tool-card` | `#f4f4f5` |

CSS variables are bridged to Tailwind tokens in `tailwind.css`, so components use `ww:`-prefixed Tailwind classes that resolve to the `--ww-*` values at runtime.

### `appearance.assistantBubble`

Assistant messages render as plain text by default. Set `assistantBubble: true` to render them in a filled bubble styled by `assistantBubbleColor` / `assistantBubbleTextColor`, matching the user bubble's radius and padding.

### Deep customization

- **React** — pass `classNames` (`ChatClassNames`) to target individual slots: `root`, `header`, `message`, `userBubble`, `assistantBubble`, `input`.
- **`<script>` embed** — the widget renders in a Shadow DOM, so host-page selectors can't reach internals. Set `--ww-*` variables (they inherit through the boundary), or inject a stylesheet with `data-css="https://.../sheet.css"` and target the stable semantic classes: `.ww-header`, `.ww-input`, `.ww-message-user .ww-bubble`, `.ww-message-assistant .ww-bubble`.

See `skills/waniwani-sdk/references/chat-widget.md` for the full customization guide and script-tag options.

## Data flow

1. `ChatEmbed` creates a `DefaultChatTransport` (from the `ai` SDK) pointed at the chat API.
2. `useChat` (from `@ai-sdk/react`) manages message state and streaming.
3. User input → `sendMessage()` → API → streamed response → rendered via `Streamdown` markdown.
4. Tool invocations group into a collapsible chain of thought; MCP App widgets render inline.
5. The conversation auto-scrolls to new messages (`use-stick-to-bottom`).
6. `PromptInput` supports file attachments via file picker, paste, and drag & drop.
