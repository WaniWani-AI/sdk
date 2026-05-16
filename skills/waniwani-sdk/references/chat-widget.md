# Chat Widget (`@waniwani/sdk/chat`)

Embed a WaniWani-powered AI chat widget on any page. Two equivalent surfaces:

| | Use when |
|---|---|
| **`<WaniwaniChat>`** — React component | You're building in React (Next.js, Vite, CRA, etc.) |
| **`<script>` embed** — IIFE bundle | You're on a marketing site, CMS, or any non-React host |

Both surfaces are powered by the same hosted backend (`app.waniwani.ai`), fetch the agent's display config from the dashboard on mount, and expose the same imperative ref API (`sendMessage`, `sendMessageAndWait`, `reset`, `focus`). Pick whichever fits your host. There is no functional difference between them.

> **Advanced:** if you self-host the chat backend (your own API route, your own auth), use the `ChatEmbed` primitive instead — see [ChatEmbed (advanced)](#chatembed-advanced) at the bottom.

## Import

```tsx
import { WaniwaniChat } from "@waniwani/sdk/chat";
import "@waniwani/sdk/chat/styles.css";
```

Peer dependencies: `react`, `react-dom`, `@ai-sdk/react`, `ai`. All other dependencies (icons, markdown rendering, scroll utilities) are bundled into the SDK.

## `<WaniwaniChat>` (React)

Configure the agent (title, welcome message, suggestions, theme, tool behavior) in the WaniWani dashboard. The component fetches that config on mount — you just hand it a token and a channel ID.

```tsx
import { WaniwaniChat } from "@waniwani/sdk/chat";

<WaniwaniChat
  token="wwp_..."
  channelId="51c3658a-1a25-43fc-84f8-13272c2aecca"
/>
```

Sized via a `height: 100%; max-height: inherit` chain — bound the chat by sizing its parent.

```tsx
<div style={{ maxHeight: 600 }}>
  <WaniwaniChat token="wwp_..." channelId="..." />
</div>
```

### Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `token` | `string` | Yes | Embed token (`wwp_...`) from the dashboard |
| `channelId` | `string` | No | Agent channel ID — routes the conversation to the right agent |
| `className` | `string` | No | Additional CSS class names applied to the root element |
| `overrides` | `WaniwaniChatOverrides` | No | Per-page tweaks. See below — dashboard is the source of truth, only reach for this when a local override is genuinely needed |

### `overrides`

The dashboard owns the agent's display and behavior config. Use `overrides` only when:

- You need a per-page tweak (e.g. a different `title` on `/pricing` vs `/about` for the same agent) and cloning an agent would be overkill.
- You want to pass `welcome` with a `ReactNode` icon — that one field can't be serialized to the dashboard.

```tsx
<WaniwaniChat
  token="wwp_..."
  channelId="..."
  overrides={{
    title: "Pricing assistant",
    welcome: {
      icon: <Logo />,
      title: "Hi, ask me about pricing",
      suggestions: ["Show me the Pro plan"],
    },
  }}
/>
```

| Field | Type | Description |
|-------|------|-------------|
| `title` | `string` | Sticky header title |
| `welcomeMessage` | `string` | Greeting shown before the first user message |
| `welcome` | `WelcomeConfig` | Rich welcome screen (icon, title, suggestion cards). Takes precedence over `welcomeMessage` |
| `placeholder` | `string` | Input placeholder |
| `suggestions` | `string[]` | Initial suggestion chips |
| `enableThreadHistory` | `boolean` | Persist conversations across reloads in IndexedDB |
| `showToolCalls` | `boolean` | Show tool call request/response panels |
| `allowAttachments` | `boolean` | Enable file attachments in the input |
| `theme` | `ChatTheme` | Theme overrides |
| `api` | `string` | Chat API URL. Defaults to `https://app.waniwani.ai/api/mcp/chat` |
| `mcpServerUrl` | `string` | Override the MCP server URL (rare) |

Overrides win over dashboard config when both are set.

### Imperative handle

Forward a `ref` of type `ChatHandle` to drive the chat from outside:

```tsx
import { useRef } from "react";
import { WaniwaniChat, type ChatHandle } from "@waniwani/sdk/chat";

function App() {
  const ref = useRef<ChatHandle>(null);

  return (
    <>
      <WaniwaniChat ref={ref} token="wwp_..." />
      <button onClick={() => ref.current?.sendMessage("Show pricing")}>
        Ask about pricing
      </button>
    </>
  );
}
```

| Method | Description |
|--------|-------------|
| `sendMessage(text)` | Submit a user message |
| `sendMessageAndWait(text)` | Submit and resolve with the final assistant message once streaming completes |
| `reset()` | Clear all messages and start fresh |
| `focus()` | Focus the chat input |
| `messages` | Current chat messages (readonly `UIMessage[]`) |

## `<script>` embed (non-React)

Self-contained IIFE bundle with React bundled. Drop a `<script>` tag on any website to inline a chat into an element on your page. Uses Shadow DOM for CSS isolation.

The embed mounts inline only — there is no floating bubble or popover panel. The chat sizes itself via a `height: 100%; max-height: inherit` CSS chain that crosses the shadow boundary, so setting `height` or `max-height` on `[data-waniwani-embed]` (or any ancestor in the chain) bounds the chat. Inside, header and input are pinned while only the messages list scrolls.

### Prerequisites

1. Generate an embed token in the WaniWani dashboard (Environment → Embed → Generate Token).

No MCP app changes needed — the embed talks to the WaniWani API directly.

### Script tag (declarative)

Place a marker element where the chat should mount; the script auto-mounts into the first `[data-waniwani-embed]` on the page:

```html
<div data-waniwani-embed></div>

<script
  src="https://cdn.jsdelivr.net/npm/@waniwani/sdk@latest/dist/chat/embed.js"
  defer
  data-token="wwp_..."
  data-title="Support"
  data-welcome-message="Hi! How can I help?"
  data-primary-color="#6366f1"
></script>
```

Bound the chat by sizing `[data-waniwani-embed]` (or an ancestor) with `height`, `max-height`, or flex/grid sizing. The chat fits within that bound and scrolls internally — no need to add `overflow: auto` yourself.

```html
<!-- max-height bound -->
<div data-waniwani-embed style="max-height: 600px;"></div>

<!-- definite height -->
<div data-waniwani-embed style="height: 600px;"></div>

<!-- flex-column item -->
<div style="display: flex; flex-direction: column; height: 100vh;">
  <header>…</header>
  <div data-waniwani-embed style="flex: 1; min-height: 0;"></div>
</div>
```

### Script tag options

| Attribute | Required | Description |
|-----------|----------|-------------|
| `data-api` | No | Chat API URL (defaults to `https://app.waniwani.ai/api/mcp/chat`) |
| `data-token` | Yes | Embed token (`wwp_...`) from WaniWani dashboard |
| `data-channel-id` | No | Agent channel ID — routes the conversation to the right agent |
| `data-title` | No | Chat header title (default: `"Assistant"`) |
| `data-welcome-message` | No | Greeting shown before first message |
| `data-placeholder` | No | Input field placeholder text |
| `data-suggestions` | No | Comma-separated suggestion chips |
| `data-enable-thread-history` | No | `"true"`/`"false"` — persist threads in IndexedDB, show thread menu in header |
| `data-show-tool-calls` | No | `"true"`/`"false"` — toggle tool call panels |
| `data-css` | No | URL to custom stylesheet (injected into Shadow DOM) |
| `data-primary-color` | No | Primary color hex |
| `data-background-color` | No | Background color hex |
| `data-text-color` | No | Text color hex |
| `data-font-family` | No | Font family |

### Programmatic init + ref API

The IIFE exposes the same imperative methods as the React ref, both globally and on the instance returned by `init()`.

```html
<script src="https://cdn.jsdelivr.net/npm/@waniwani/sdk@latest/dist/chat/embed.js" defer></script>
<script>
  window.addEventListener('DOMContentLoaded', async function() {
    const chat = window.WaniWani.chat.init({
      token: 'wwp_...',
      title: 'Support',
      theme: { primaryColor: '#6366f1' },
    });

    // Fire-and-forget
    chat.sendMessage('Show me pricing');

    // Submit and await the final assistant message
    const reply = await chat.sendMessageAndWait('What plans do you offer?');
    console.log(reply);

    // Snapshot the current conversation
    console.log(chat.getMessages());

    // Clear messages, focus input
    chat.reset();
    chat.focus();

    // Cleanup
    chat.destroy();
  });
</script>
```

`window.WaniWani.chat` and the instance returned by `init()` both expose:

| Method | Description |
|--------|-------------|
| `init(options?)` | Mount the chat (only on `window.WaniWani.chat`) |
| `destroy()` | Unmount the chat |
| `sendMessage(text)` | Submit a user message |
| `sendMessageAndWait(text)` | Submit and resolve with the final assistant message |
| `reset()` | Clear all messages |
| `focus()` | Focus the chat input |
| `getMessages()` | Snapshot of current `UIMessage[]` |

Pre-mount, write methods no-op silently and read methods return `undefined` / `[]`. Pick whichever feels right — call them globally (`window.WaniWani.chat.sendMessage(...)`) when you don't have the instance handle, or on the instance when you do.

### How auth works

The embed sends `Authorization: Bearer wwp_...` on every request directly to the WaniWani API. The token is verified server-side against the `embed_tokens` table. No customer MCP app changes needed — generate tokens in the dashboard, paste the `<script>` tag.

### Remote config

On mount the widget (both React and script) fetches `GET {api}/config` with the embed token and merges the response into its settings. Configure the agent from the WaniWani dashboard (Environment → Embed Chat Config):

| Server-only | Display-only |
|---|---|
| `systemPrompt`, `maxSteps` — applied at inference, never leak to the browser | `title`, `welcomeMessage`, `placeholder`, `suggestions` — sent to the widget |

Merge order (later wins): **defaults < remote config < `data-*` attrs < programmatic options**. The dashboard value is the default; data-attrs / props still override per-page if you need a local tweak.

## Shared building blocks

### `WelcomeConfig`

Rich welcome screen replacing `welcomeMessage`. Shown when the conversation is empty. Passed under `overrides` because its `icon` is a `ReactNode` and can't live in the dashboard.

```tsx
<WaniwaniChat
  token="wwp_..."
  channelId="..."
  overrides={{
    welcome: {
      icon: <Logo />,
      title: "Welcome to Support",
      description: "Ask me anything about our product.",
      suggestions: ["How does pricing work?", "Show me a demo"],
    },
  }}
/>
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `icon` | `React.ReactNode` | No | Icon above the title (SVG, img, etc.) |
| `title` | `string` | Yes | Title text |
| `description` | `string` | No | Description below the title |
| `suggestions` | `string[]` | No | Clickable suggestion cards (disappear after first message) |

### Theming

Theme is normally set in the dashboard. For per-page overrides, pass `theme` under `overrides`. A `DARK_THEME` preset is also available.

```tsx
import { DARK_THEME, mergeTheme } from "@waniwani/sdk/chat";

<WaniwaniChat token="wwp_..." channelId="..." overrides={{ theme: DARK_THEME }} />
<WaniwaniChat
  token="wwp_..."
  channelId="..."
  overrides={{ theme: mergeTheme(DARK_THEME, { primaryColor: "#6366f1" }) }}
/>
```

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
| `headerBackgroundColor` | -- | (backgroundColor) |
| `headerTextColor` | -- | (textColor) |
| `statusColor` | -- | `#22c55e` |
| `toolCardColor` | -- | light gray / `#262626` in dark |
| `borderRadius` | `--ww-radius` | `16px` |
| `messageBorderRadius` | `--ww-msg-radius` | `12px` |
| `fontFamily` | `--ww-font` | system stack |

Theme utilities: `DEFAULT_THEME`, `DARK_THEME`, `mergeTheme(base, overrides)`, `themeToCSSProperties(theme)`.

### Event tracking

When `apiKey` is provided (advanced `ChatEmbed` setups), the widget automatically tracks:

| Event | Trigger |
|-------|---------|
| `chat.opened` | Widget mounts |
| `chat.message_sent` | User sends a message |
| `chat.response_received` | Streaming response completes |

Tracking is fire-and-forget — failures never break the chat.

## `ChatEmbed` (advanced)

**Most apps should use `WaniwaniChat` or the `<script>` embed.** `ChatEmbed` is the bare-bones primitive underneath both of them: no token, no remote config, no defaults, no built-in MCP resource endpoint. You wire up `api`, `headers`, `body`, `theme`, and (optionally) `mcp` yourself.

Reach for it when you self-host the chat backend (your own Next.js/Express route, your own provider) and don't want WaniWani's hosted features.

```tsx
import { ChatEmbed } from "@waniwani/sdk/chat";

// Self-hosted chat endpoint
<ChatEmbed
  api="/api/my-chat-endpoint"
  body={{ environmentId, sessionId }}
  theme={{ backgroundColor: "#fff" }}
/>

// With MCP App widget support
<ChatEmbed
  api="/api/my-chat-endpoint"
  mcp={{ resourceEndpoint: "/api/mcp/resource" }}
/>
```

The component fills its parent container (`width: 100%; height: 100%`) with no header, border, or shadow.

`ChatEmbed`-specific props:

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `api` | `string` | Yes | Chat API endpoint (no default) |
| `mcp` | `ChatEmbedMcpConfig` | No | MCP Apps config for widget iframes (`resourceEndpoint`, `onCallTool`) |
| `title` | `string` | No | When set, renders the sticky header with this title |
| `headerActions` | `ReactNode` | No | Extra React node rendered on the right of the header |
| `readOnly` | `boolean` | No | Hide the input bar |
| `className` | `string` | No | Additional CSS class names |

Plus all shared `ChatBaseProps` (`headers`, `body`, `theme`, `welcomeMessage`, `welcome`, `placeholder`, `suggestions`, `allowAttachments`, `enableThreadHistory`, `showToolCalls`, `onMessageSent`, `onResponseReceived`, `onCallTool`, `debug`, `triggerEvent`).

The same `ChatHandle` ref API works on `ChatEmbed`. See [Imperative handle](#imperative-handle) above.

## Additional components

- **`McpAppFrame`** — Renders MCP App widget iframes inside chat. Forwards tool result `_meta` via `ui/notifications/tool-result` for widget tracking config.

## Common mistakes

- **Wrong import path** — Use `@waniwani/sdk/chat`, not `@waniwani/sdk`
- **Missing stylesheet** — Import `@waniwani/sdk/chat/styles.css` alongside the component
- **Missing peer deps** — Requires `react`, `react-dom`, `@ai-sdk/react`, and `ai`. Everything else is bundled.
- **Embed cleanup** — Always call `chat.destroy()` (or unmount the React tree) to prevent memory leaks
- **Shadow DOM styling** — The `<script>` embed uses Shadow DOM; external CSS won't affect widget styles. Use the `theme` prop / `data-*-color` attrs instead.
- **Using `ChatEmbed` when `WaniwaniChat` would do** — `ChatEmbed` is the BYO-backend primitive; if you're talking to `app.waniwani.ai`, `WaniwaniChat` is the right choice.
