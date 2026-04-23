# Chat Widget (`@waniwani/sdk/chat`)

React components for embedding an AI chat widget with theming, MCP Apps support, and automatic event tracking. Three layout variants for different use cases.

## Import

```tsx
import { ChatBar, ChatCard, ChatEmbed } from "@waniwani/sdk/chat";
import "@waniwani/sdk/chat/styles.css";
```

`ChatWidget` is a backward-compatible alias for `ChatBar`.

Peer dependencies: `react`, `react-dom`, `@ai-sdk/react`, `ai`

All other dependencies (icons, markdown rendering, scroll utilities) are bundled into the SDK.

## Layout Components

### `ChatBar` (default)

Compact floating bar that expands upward into a chat panel. Best for bottom-of-page placement.

```tsx
<ChatBar
  apiKey="ww_..."
  title="Support"
  width={600}
  expandedWidth={720}
  expandedHeight={400}
  theme={{ primaryColor: "#6366f1" }}
/>
```

**ChatBar-specific props:**

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `width` | `number` | `600` | Bar width in pixels |
| `expandedWidth` | `number` | `width * 1.2` | Expanded card width |
| `expandedHeight` | `number` | `400` | Max height of expanded messages panel |
| `title` | `string` | `"Assistant"` | Header title when expanded |

### `ChatCard`

Always-visible card with a header, status dot, and optional subtitle. Best for dedicated chat sections.

```tsx
<ChatCard
  apiKey="ww_..."
  title="Support"
  subtitle="Ask us anything"
  showStatus={true}
  width={500}
  height={600}
  theme={{ primaryColor: "#6366f1" }}
/>
```

**ChatCard-specific props:**

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `title` | `string` | `"Assistant"` | Header title |
| `subtitle` | `string` | -- | Subtitle text under the title |
| `showStatus` | `boolean` | `true` | Show the status dot in header |
| `width` | `number \| string` | `500` | Card width (px number or CSS value like `"100%"`) |
| `height` | `number \| string` | `600` | Card height (px number or CSS value like `"80vh"`) |
| `className` | `string` | -- | Additional CSS class names |

### `ChatEmbed`

Borderless, bring-your-own-backend chat. Fills its parent container. No header, border, or shadow. Does not call the WaniWani hosted backend -- you provide the `api` endpoint.

```tsx
<ChatEmbed
  api="/api/my-chat-endpoint"
  body={{ environmentId, sessionId }}
  theme={{ backgroundColor: "#fff" }}
/>

// With MCP Apps widget support
<ChatEmbed
  api="/api/my-chat-endpoint"
  mcp={{ resourceEndpoint: "/api/mcp/resource" }}
/>
```

**ChatEmbed-specific props:**

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `api` | `string` | Yes | Chat API endpoint (no default) |
| `className` | `string` | No | Additional CSS class names |
| `mcp` | `ChatEmbedMcpConfig` | No | MCP Apps config for widget iframes |

**`ChatEmbedMcpConfig`:**

| Field | Type | Description |
|-------|------|-------------|
| `resourceEndpoint` | `string` | Endpoint serving MCP app resources (`GET ${endpoint}?uri=...`) |
| `onCallTool` | `CallToolHandler` | Handler for MCP tool calls from widgets |

## Shared Props (`ChatBaseProps`)

All layout components share these props:

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `apiKey` | `string` | -- | WaniWani project API key |
| `api` | `string` | WaniWani hosted endpoint | Chat API endpoint URL |
| `initialMessages` | `UIMessage[]` | -- | Pre-loaded messages on mount |
| `welcomeMessage` | `string` | -- | Initial greeting text |
| `welcome` | `WelcomeConfig` | -- | Rich welcome screen (takes precedence over `welcomeMessage`) |
| `theme` | `ChatTheme` | `DEFAULT_THEME` | Theme overrides |
| `headers` | `Record<string, string>` | -- | Additional headers for API requests |
| `body` | `Record<string, unknown>` | -- | Additional body fields per request |
| `allowAttachments` | `boolean` | `false` | Enable file attachments in input |
| `placeholder` | `string` | `"Ask me anything..."` | Input placeholder (typing animation) |
| `triggerEvent` | `string \| false` | `"triggerDemoRequest"` | DOM event to trigger focus/send. Dispatch via `new CustomEvent('triggerDemoRequest', { detail: { message: 'Hi!' } })`. Set `false` to disable. |
| `suggestions` | `boolean \| SuggestionsConfig` | -- | AI-generated suggestions. `true` for defaults, object for config. |
| `onCallTool` | `CallToolHandler` | -- | Handler for MCP tool calls from widgets |
| `debug` | `boolean` | `false` | Show `_meta` in tool call inputs/outputs |
| `onMessageSent` | `(message: string) => void` | -- | Callback on message sent |
| `onResponseReceived` | `() => void` | -- | Callback on response received |

### `WelcomeConfig`

Rich welcome screen replacing `welcomeMessage`. Shown when the conversation is empty.

```tsx
<ChatCard
  welcome={{
    icon: <Logo />,
    title: "Welcome to Support",
    description: "Ask me anything about our product.",
    suggestions: ["How does pricing work?", "Show me a demo"],
  }}
/>
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `icon` | `React.ReactNode` | No | Icon above the title (SVG, img, etc.) |
| `title` | `string` | Yes | Title text |
| `description` | `string` | No | Description below the title |
| `suggestions` | `string[]` | No | Clickable suggestion cards (disappear after first message) |

### `SuggestionsConfig`

```tsx
<ChatCard suggestions={{ initial: ["Pricing", "Demo"], dynamic: true }} />
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `initial` | `string[]` | `[]` | Suggestions before user's first message |
| `dynamic` | `boolean` | `true` | Enable AI-generated suggestions after each response |

## Imperative Handle (`ChatHandle`)

Access chat methods via a ref. Works with all layout components.

```tsx
import { useRef } from "react";
import { ChatCard } from "@waniwani/sdk/chat";
import type { ChatHandle } from "@waniwani/sdk/chat";

function App() {
  const chatRef = useRef<ChatHandle>(null);

  return (
    <>
      <ChatCard ref={chatRef} apiKey="ww_..." />
      <button onClick={() => chatRef.current?.sendMessage("Show pricing")}>
        Ask about pricing
      </button>
    </>
  );
}
```

| Method | Description |
|--------|-------------|
| `sendMessage(text)` | Programmatically send a user message |
| `sendMessageAndWait(text)` | Send and wait for the assistant response to complete |
| `reset()` | Clear all messages and start fresh |
| `focus()` | Scroll to input, focus it, and show a highlight glow |
| `messages` | Current chat messages (readonly) |

## Theming

Pass a `theme` object to override defaults. A `DARK_THEME` preset is also available.

```tsx
import { DARK_THEME, mergeTheme } from "@waniwani/sdk/chat";

<ChatCard theme={DARK_THEME} />
<ChatCard theme={mergeTheme(DARK_THEME, { primaryColor: "#6366f1" })} />
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

## Event Tracking

When `apiKey` is provided, the widget automatically tracks:

| Event | Trigger |
|-------|---------|
| `chat.opened` | Widget mounts |
| `chat.message_sent` | User sends a message |
| `chat.response_received` | Streaming response completes |

Tracking is fire-and-forget -- failures never break the chat.

## Embed Script (Non-React)

Self-contained IIFE bundle (~186KB gzipped) with React bundled. Drop a `<script>` tag on any website to get a floating chat bubble. Uses Shadow DOM for CSS isolation.

### Prerequisites

1. Generate embed token in WaniWani dashboard (Environment → Embed → Generate Token)

No MCP app changes needed — the embed talks to WaniWani API directly.

### Script Tag (declarative)

Default mode is `inline` — the chat mounts into the first `[data-waniwani-embed]` element on the page:

```html
<div data-waniwani-embed style="width: 400px; height: 600px;"></div>

<script
  src="https://cdn.jsdelivr.net/npm/@waniwani/sdk@latest/dist/chat/embed.js"
  defer
  data-token="wwp_..."
  data-title="Support"
  data-welcome-message="Hi! How can I help?"
  data-primary-color="#6366f1"
></script>
```

For a floating bubble instead, add `data-mode="floating"`.

### Script Tag Options

| Attribute | Required | Description |
|-----------|----------|-------------|
| `data-api` | No | Chat API URL (defaults to `https://app.waniwani.ai/api/mcp/chat`) |
| `data-token` | Yes | Embed token (`wwp_...`) from WaniWani dashboard |
| `data-title` | No | Chat header title (default: `"Assistant"`) |
| `data-welcome-message` | No | Greeting shown before first message |
| `data-placeholder` | No | Input field placeholder text |
| `data-suggestions` | No | Comma-separated suggestion chips |
| `data-position` | No | `"bottom-right"` (default) or `"bottom-left"` |
| `data-mode` | No | `"inline"` (default), `"floating"`, or `"custom"`. See [Display modes](#display-modes) below. |
| `data-layout` | No | In `inline` mode: `"card"` (default), `"bar"`, or `"embed"`. Picks the layout component. Ignored in other modes. |
| `data-width` | No | Panel width in px (default: `400`) |
| `data-height` | No | Panel height in px (default: `600`) |
| `data-css` | No | URL to custom stylesheet (injected into Shadow DOM) |
| `data-primary-color` | No | Primary color hex |
| `data-background-color` | No | Background color hex |
| `data-text-color` | No | Text color hex |
| `data-font-family` | No | Font family |

### Display Modes

Pick how the widget appears with `data-mode` (or `mode` in `init()`):

| Mode | Behaviour | Use when |
|---|---|---|
| `inline` (default) | Layout component renders directly into the first `[data-waniwani-embed]` element on the page. No bubble, no panel, no overlay. | You want the chat embedded as a block on a page (e.g. landing page hero). |
| `floating` | SDK renders a floating bubble bottom-right/left; clicking it toggles a popover panel. | Standard drop-in chat bubble. |
| `custom` | Popover panel only — no bubble. Consumer renders their own launcher and calls `WaniWani.chat.open()` / `toggle()`. | You want the bubble replaced by a branded button, nav item, etc. |

#### Inline mode

Place a marker element anywhere on the page — the SDK mounts into it:

```html
<div data-waniwani-embed style="width: 400px; height: 600px;"></div>

<script
  src="https://cdn.jsdelivr.net/npm/@waniwani/sdk@latest/dist/chat/embed.js"
  defer
  data-token="wwp_..."
  data-mode="inline"
></script>
```

Pick the layout with `data-layout` (inline only):

| Value | Component | Shape |
|---|---|---|
| `card` (default) | `ChatCard` | Bordered card with header, messages, input. |
| `bar` | `ChatBar` | Compact input bar that expands upward on focus. |
| `embed` | `ChatEmbed` | Borderless, fills parent container (no header). |

```html
<div data-waniwani-embed style="width: 600px; height: 80px;"></div>
<script src=".../embed.js" defer
  data-token="wwp_..."
  data-mode="inline"
  data-layout="bar"
></script>
```

#### Custom launcher

Set `data-mode="custom"` to suppress the built-in bubble. The panel still mounts (hidden) and opens via `WaniWani.chat.open()`:

```html
<script
  src="https://cdn.jsdelivr.net/npm/@waniwani/sdk@latest/dist/chat/embed.js"
  defer
  data-token="wwp_..."
  data-mode="custom"
></script>

<button onclick="WaniWani.chat.toggle()">Chat with us</button>
```

`open`, `close`, and `toggle` are exposed on the instance returned by `init()` and on `window.WaniWani.chat`. They're no-ops in `inline` mode (nothing to open).

### Programmatic Init

```js
<script src="https://cdn.jsdelivr.net/npm/@waniwani/sdk@latest/dist/chat/embed.js" defer></script>
<script>
  window.addEventListener('DOMContentLoaded', function() {
    var chat = window.WaniWani.chat.init({
      token: 'wwp_...',
      title: 'Support',
      theme: { primaryColor: '#6366f1' },
    });

    // Imperative control (floating mode only)
    chat.open();
    chat.close();
    chat.toggle();

    // Cleanup
    chat.destroy();
  });
</script>
```

### How Auth Works

The embed widget sends `Authorization: Bearer wwp_...` on every request directly to the WaniWani API. The token is verified server-side against the `embed_tokens` table. No customer MCP app changes needed — generate tokens in the dashboard, paste the `<script>` tag.

### Remote Config

On mount the widget fetches `GET {data-api}/config` with the embed token and merges the response into its settings. Configure the agent from the WaniWani dashboard (environment → Embed Chat Config):

| Server-only | Display-only |
|---|---|
| `systemPrompt`, `maxSteps` — applied at inference, never leak to the browser | `title`, `welcomeMessage`, `placeholder`, `suggestions` — sent to the widget |

Merge order (later wins): **defaults < remote config < `data-*` attrs < programmatic `init()`**. So the dashboard value is the default and data-attrs still override per-page if you need a local tweak.

## Additional Components

- **`McpAppFrame`** -- Renders MCP App widget iframes inside chat. Forwards tool result `_meta` via `ui/notifications/tool-result` for widget tracking config.
- **`ScenarioPanel`** -- Eval/scenario panel component for testing chat flows.

## Common Mistakes

- **Wrong import path** -- Use `@waniwani/sdk/chat`, not `@waniwani/sdk`
- **Missing stylesheet** -- Import `@waniwani/sdk/chat/styles.css` alongside the component
- **Missing peer deps** -- Requires `react`, `react-dom`, `@ai-sdk/react`, and `ai`. Everything else is bundled.
- **Embed cleanup** -- Always call `chat.destroy()` on unmount to prevent memory leaks
- **Shadow DOM styling** -- The embed script uses Shadow DOM; external CSS won't affect widget styles. Use the `theme` prop instead.
- **Using `ChatWidget` for new code** -- `ChatWidget` is a deprecated alias for `ChatBar`. Use `ChatBar`, `ChatCard`, or `ChatEmbed` directly.
