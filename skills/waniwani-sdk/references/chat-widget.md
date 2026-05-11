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

Bring-your-own-backend chat with an internal flex column (pinned header, scrolling messages, pinned input). It self-sizes to the customer's bounded container — works for `height`, `max-height`, and flex/grid bounded ancestors — by measuring the outer container with a `ResizeObserver` (a temporary tall sentinel forces `max-height` to engage during the read). Falls back to `min(80svh, 700px)` if no bounding ancestor is found.

```tsx
// Headerless — fills parent's bounded height
<ChatEmbed
  api="/api/my-chat-endpoint"
  body={{ environmentId, sessionId }}
  theme={{ backgroundColor: "#fff" }}
/>

// With header + thread history
<ChatEmbed
  api="/api/my-chat-endpoint"
  title="Support"
  enableThreadHistory
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
| `title` | `string` | No | When set, renders the header with this title |
| `headerActions` | `ReactNode` | No | Extra React node rendered on the right of the header |
| `readOnly` | `boolean` | No | Hide the input bar |

**Sizing:** any of these work — the chat fits within whichever bound the customer's container provides.

```tsx
// max-height bound
<div style={{ maxHeight: 600 }}>
  <ChatEmbed api="/api/chat" title="Support" />
</div>

// definite height
<div style={{ height: 600 }}>
  <ChatEmbed api="/api/chat" />
</div>

// flex-column item with bounded flex sizing
<div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
  <header />
  <ChatEmbed api="/api/chat" />  {/* flex: 1 fills remaining height */}
</div>
```

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

Self-contained IIFE bundle with React bundled. Drop a `<script>` tag on any website to inline a chat into an element on your page. Uses Shadow DOM for CSS isolation.

The embed mounts inline only — there is no floating bubble or popover panel. The chat self-sizes to the bounded height of `[data-waniwani-embed]` (or any ancestor that bounds it via `height`, `max-height`, or flex/grid). Inside, header and input are pinned while only the messages list scrolls. If no bounding ancestor is found, the chat falls back to `min(80svh, 700px)`.

### Prerequisites

1. Generate embed token in WaniWani dashboard (Environment → Embed → Generate Token)

No MCP app changes needed — the embed talks to WaniWani API directly.

### Script Tag (declarative)

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

### Script Tag Options

| Attribute | Required | Description |
|-----------|----------|-------------|
| `data-api` | No | Chat API URL (defaults to `https://app.waniwani.ai/api/mcp/chat`) |
| `data-token` | Yes | Embed token (`wwp_...`) from WaniWani dashboard |
| `data-title` | No | Chat header title (default: `"Assistant"`) |
| `data-welcome-message` | No | Greeting shown before first message |
| `data-placeholder` | No | Input field placeholder text |
| `data-suggestions` | No | Comma-separated suggestion chips |
| `data-enable-thread-history` | No | `"true"`/`"false"` — persist threads in IndexedDB, show thread menu in header |
| `data-css` | No | URL to custom stylesheet (injected into Shadow DOM) |
| `data-primary-color` | No | Primary color hex |
| `data-background-color` | No | Background color hex |
| `data-text-color` | No | Text color hex |
| `data-font-family` | No | Font family |

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

    // Send a message programmatically
    window.WaniWani.chat.sendMessage('Show me pricing');

    // Cleanup
    chat.destroy();
  });
</script>
```

`window.WaniWani.chat` exposes: `init(options?)`, `destroy()`, `sendMessage(text)`.

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
