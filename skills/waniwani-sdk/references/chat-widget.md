# Chat Widget (`@waniwani/sdk/chat`)

Embed a Waniwani-powered AI chat widget on any page. Two equivalent surfaces:

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

Configure the agent (title, welcome message, suggestions, theme, tool behavior) in the Waniwani dashboard. The component fetches that config on mount — you just hand it a token and a channel ID.

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
| `showToolCalls` | `boolean \| "titles-only"` | How the agent's tool-call activity renders, grouped into one collapsible "chain of thought". `true` (default) — each step expandable to its request/response JSON. `"titles-only"` — step labels only, no JSON. `false` — hides the chain entirely (including the reasoning trace); only the generic "On it…" indicator shows while the agent works. MCP App widgets always render regardless. |
| `allowAttachments` | `boolean` | Enable file attachments in the input |
| `appearance` | `ChatAppearance` | Theme preset + per-property overrides — see [Theming the chat widget](#theming-the-chat-widget) |
| `api` | `string` | Chat API URL. Defaults to `https://app.waniwani.ai/api/mcp/chat` |
| `mcpServerUrl` | `string` | Override the MCP server URL (rare) |
| `locale` | `"en" \| "fr" \| "es"` | UI language for built-in labels. Auto-detected from `<html lang>` / `navigator.language` when omitted; falls back to English |
| `messages` | `MessageOverrides` | Per-key overrides on top of the resolved locale catalog — see [Languages](#languages) |
| `disablePageView` | `boolean` | Opt out of the top-of-funnel `page.viewed` event fired once on mount. Defaults to `false`. Set `true` on surfaces where a page view is noise — an already-authenticated app shell, an internal tool, a preview — so it doesn't pollute the funnel. See [Tracked events](#event-tracking) |

Overrides win over dashboard config when both are set.

### Languages

Built-in widget strings (input placeholder, "Thinking…", "Copy"/"Copied", thread menu, "AI can make mistakes", etc.) ship translated to English, French, and Spanish. The widget detects the active locale from `<html lang>`, then `navigator.language` / `navigator.languages`, falling back to English when none match. Region tags fall back to the language prefix (`fr-CA` → `fr`).

Pin the language explicitly:

```tsx
<WaniwaniChat
  token="wwp_..."
  overrides={{ locale: "fr" }}
/>
```

Override individual strings without contributing a full locale (useful for one-off brand voice tweaks):

```tsx
<WaniwaniChat
  token="wwp_..."
  overrides={{
    locale: "en",
    messages: {
      promptInput: { placeholder: "Ask the agent…" },
      aiDisclaimer: { default: "may occasionally err" },
    },
  }}
/>
```

For the `<script>` embed, use `data-locale="fr|es|en"` — see the script tag options table.

Dashboard-configurable strings (`title`, `welcomeMessage`, `placeholder`, `suggestions`, `disclaimer`) are still authored once per agent — they always win over the locale catalog when set.

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

Self-contained IIFE bundle with React bundled. Drop a `<script>` tag on any website to add a chat. Uses Shadow DOM for CSS isolation.

Two render modes, chosen with `data-mode`:

- **`inline`** (default) — mounts the chat into a `[data-waniwani-embed]` element. **You don't have to add that element** — if the page has none, the embed creates one and inserts it immediately in front of the `<script>` tag, so the bare snippet works as-is. A container the embed creates is presented as a **centered, rounded card** (≈448px wide, 500px tall, with a subtle border + shadow); a container **you** place keeps its own layout (full width unless you size it). See [Sizing the inline embed](#sizing-the-inline-embed).
- **`floating`** — docks a thin chat input at the bottom of the screen; clicking it widens the bar and reveals starter suggestions, then the full chat expands open from the input on the first message (card on desktop, full-screen on mobile). No marker element needed. See [Floating mode](#floating-mode).

### Prerequisites

1. Generate an embed token in the Waniwani dashboard (Environment → Embed → Generate Token).

No MCP app changes needed — the embed talks to the Waniwani API directly.

### Script tag (declarative)

The simplest possible snippet — no markup, no CSS — mounts an inline chat where the `<script>` sits, rendered as a centered, rounded card (≈448px wide × 500px tall):

```html
<script
  src="https://app.waniwani.ai/embed.js"
  defer
  data-token="wwp_..."
  data-title="Support"
  data-theme="light"
  data-welcome-message="Hi! How can I help?"
></script>
```

To control *where* the chat mounts (and to size it yourself), place a `[data-waniwani-embed]` element on the page; the script mounts into the first one it finds instead of creating its own.

```html
<div data-waniwani-embed></div>
<script src="…/embed.js" defer data-token="wwp_..."></script>
```

### How the script loads & updates

The `src` is `https://app.waniwani.ai/embed.js`, **not** a CDN URL. That endpoint is a tiny **loader**: it resolves the latest published SDK version server-side and injects the real, version-pinned bundle from jsdelivr. You get automatic updates without ever editing the snippet.

Two things make this work, and they matter if you're debugging "why am I still seeing the old widget":

- **The loader is short-cached (`max-age=300`).** Waniwani controls this header, so a new release reaches every page within ~5 minutes. This is the knob a public CDN doesn't give you.
- **The bundle it injects is version-pinned and immutable.** The loader emits `…/@waniwani/sdk@<exact-version>/dist/chat/embed.js`, which jsdelivr caches for a year. Fast, and it never goes stale for the wrong reasons.

You don't need to purge anything on release. Do **not** hard-code a `cdn.jsdelivr.net/...@latest/...` URL yourself: mutable jsdelivr tags are served with a **7-day** browser cache Waniwani can't invalidate, so returning visitors would stay on an old build for up to a week. Always point at `app.waniwani.ai/embed.js`.

> Serving the loader from the vendor's own domain (rather than a public CDN) is the standard pattern for embeddable widgets — Intercom (`widget.intercom.io`, `max-age=300`), Crisp (`client.crisp.chat/l.js`), and Drift (`js.driftt.com`, `no-cache`) all do the same, for the same reason: it's the only way to control how fast an update reaches your page.

**Scenarios:**

| Situation | What happens |
|---|---|
| Waniwani publishes a new SDK version | Within ~5 min the loader resolves it and pages inject the new pinned bundle. No action from you. |
| A visitor loaded your page an hour ago, returns now | Their browser revalidates the loader (5-min TTL lapsed), picks up the current version, and swaps to the new bundle. |
| You want to confirm which version is live | `curl -sI https://app.waniwani.ai/embed.js` — the `X-Waniwani-Embed-Version` header shows the pinned version currently served. |
| You need to pin a version (e.g. reproduce a bug) | Temporarily point `src` at `https://cdn.jsdelivr.net/npm/@waniwani/sdk@<version>/dist/chat/embed.js`. Immutable, but you lose auto-updates — revert to the loader afterward. |
| jsdelivr/npm briefly unreachable when the loader resolves | The loader falls back to a known-good pinned version, never `@latest` — so a resolution blip never degrades your cache posture. |

### Sizing the inline embed

The inline container defaults to `height: 500px`. The default is applied with a `:where()` rule (specificity 0), so **any** of these overrides wins:

```html
<!-- Per-embed, no CSS: data-height accepts any CSS length (a bare number = px) -->
<script src="…/embed.js" defer data-token="wwp_..." data-height="500px"></script>
```

```css
/* A definite height */
[data-waniwani-embed] { height: 80vh; }

/* Shrink-to-content, capped — opt out of the fixed height with `auto` */
[data-waniwani-embed] { height: auto; max-height: 600px; }

/* Fill a flex column */
[data-waniwani-embed] { height: auto; flex: 1; min-height: 0; }
```

The chat fits within whatever bound you set and scrolls internally — no need to add `overflow: auto` yourself. Inside, the header and input are pinned while only the messages list scrolls.

### Script tag options

| Attribute | Required | Description |
|-----------|----------|-------------|
| `data-api` | No | Chat API URL (defaults to `https://app.waniwani.ai/api/mcp/chat`) |
| `data-token` | Yes | Embed token (`wwp_...`) from Waniwani dashboard |
| `data-channel-id` | No | Agent channel ID — routes the conversation to the right agent |
| `data-title` | No | Chat header title (default: `"Assistant"`) |
| `data-welcome-message` | No | Greeting shown before first message |
| `data-placeholder` | No | Input field placeholder text |
| `data-suggestions` | No | Comma-separated suggestion chips |
| `data-enable-thread-history` | No | `"true"`/`"false"` — persist threads in IndexedDB, show thread menu in header |
| `data-show-tool-calls` | No | Tool-call activity rendering (grouped into one collapsible chain). `"true"` (default) — steps expandable to request/response JSON. `"titles-only"` — step labels only. `"false"` — hides the chain and the reasoning trace; only the "On it…" indicator shows |
| `data-css` | No | URL to custom stylesheet (injected into Shadow DOM) |
| `data-theme` | No | `"light"` (default), `"dark"`, or `"auto"` (follow `prefers-color-scheme`) |
| `data-assistant-bubble` | No | `"true"`/`"false"` — render assistant replies in a filled, themeable bubble. Defaults to `"false"` (plain text). See [Assistant message bubble](#4-assistant-message-bubble-opt-in) |
| `data-locale` | No | `"en"`, `"fr"`, or `"es"`. Auto-detects from `<html lang>` / `navigator.language` when omitted |
| `data-mode` | No | `"inline"` (default) or `"floating"` — see [Floating mode](#floating-mode) |
| `data-height` | No | Inline only. Default container height — any CSS length (`"500px"`, `"80vh"`) or a bare number (px). Defaults to `500px` |
| `data-launcher-text` | No | Floating only. Overrides the docked input's placeholder. Defaults to the agent's configured input placeholder (typed out), then a localized "Ask anything…" |
| `data-appear-delay` | No | Floating only. Milliseconds to wait after the page renders before the docked input animates in. Defaults to `2000`. `0` shows it immediately (still fades in) |
| `data-disable-page-view` | No | `"true"` (or a bare attribute) opts out of the top-of-funnel `page.viewed` event fired once on init. Use on surfaces where a page view is noise. See [Tracked events](#event-tracking) |

For finer-grained colour, radius, or font overrides, set CSS variables on the container — see [Theming the chat widget](#theming-the-chat-widget).

### Floating mode

Set `data-mode="floating"` for a docked, progressively-revealing chat (no `[data-waniwani-embed]` element needed — the surface is appended to `<body>` and overlays the page without blocking it). It has three states:

1. **Docked input** — after `data-appear-delay` (default 2s, so the page settles first) a thin input bar animates in at the bottom of the screen (not a launcher button). It mirrors the in-chat composer: a soft-rounded card, no decorative icon. The page stays fully usable.
2. **Expanded** — clicking/focusing the bar widens it and, a beat later, fades in the agent's starter suggestions as the same chips used inside the chat. The chat does **not** open yet. Clicking away collapses it back to the resting width. (With no suggestions, the bar just widens.)
3. **Full chat** — the moment the visitor sends a message (typed or a suggestion), the full chat panel expands open from the input's position: a card on desktop, full-screen on mobile. The header "−" collapses back to the docked input.

```html
<script
  src="https://app.waniwani.ai/embed.js"
  defer
  data-token="wwp_..."
  data-mode="floating"
  data-launcher-text="Ask anything"
  data-title="Support"
  data-theme="auto"
></script>
```

The docked input types out the agent's configured input placeholder (set `data-launcher-text` to override it); the starter suggestions come from the agent's dashboard config (or `data-suggestions`). Once the conversation has started, focusing the dock re-opens the full chat (with history) instead of re-showing the suggestions. The dock and panel inherit the theme, so `data-theme` and any `--ww-primary` override apply. Drive it from JS with `window.WaniWani.chat.open()` / `.close()` / `.toggle()`; `sendMessage` / `focus` open the full panel automatically.

### Programmatic init + ref API

The IIFE exposes the same imperative methods as the React ref, both globally and on the instance returned by `init()`.

```html
<script src="https://app.waniwani.ai/embed.js" defer></script>
<script>
  window.addEventListener('DOMContentLoaded', async function() {
    const chat = window.WaniWani.chat.init({
      token: 'wwp_...',
      title: 'Support',
      appearance: { theme: 'dark', variables: { primaryColor: '#6366f1' } },
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
| `open()` / `close()` / `toggle()` | Floating mode: open/close/toggle the panel. No-op in inline mode |
| `sendMessage(text)` | Submit a user message (opens the panel in floating mode) |
| `sendMessageAndWait(text)` | Submit and resolve with the final assistant message |
| `reset()` | Clear all messages |
| `focus()` | Focus the chat input (opens the panel in floating mode) |
| `getMessages()` | Snapshot of current `UIMessage[]` |

Pre-mount, write methods no-op silently and read methods return `undefined` / `[]`. Pick whichever feels right — call them globally (`window.WaniWani.chat.sendMessage(...)`) when you don't have the instance handle, or on the instance when you do.

### How auth works

The embed sends `Authorization: Bearer wwp_...` on every request directly to the Waniwani API. The token is verified server-side against the `embed_tokens` table. No customer MCP app changes needed — generate tokens in the dashboard, paste the `<script>` tag.

### Remote config

On mount the widget (both React and script) fetches `GET {api}/config` with the embed token and merges the response into its settings. Configure the agent from the Waniwani dashboard (Environment → Embed Chat Config):

| Server-only | Display-only |
|---|---|
| `systemPrompt`, `maxSteps` — applied at inference, never leak to the browser | `title`, `welcomeMessage`, `placeholder`, `suggestions` — sent to the widget |

Merge order (later wins): **defaults < remote config < `data-*` attrs < programmatic options**. The dashboard value is the default; data-attrs / props still override per-page if you need a local tweak.

### Per-URL visibility (advanced)

By default a chat surface shows on every page it's loaded on. For surfaces dropped into a site-wide template (the floating bar, an inline embed, or `<WaniwaniChat>` in a shared layout), you can restrict where they appear with per-channel show/hide rules configured in the dashboard.

The rules match against `window.location.pathname`:

- **Default action** — show everywhere and hide on a few paths, or hide everywhere and allowlist a few.
- **Patterns** — `*` matches within one path segment (`/docs/*` matches `/docs/intro`, not `/docs/a/b`); `**` matches across segments (`/docs/**` matches everything under `/docs/`). Anything else is matched literally.
- **Precedence** — when several patterns match, the last one in the list wins.

This applies to **every** chat surface: floating, inline, and React. Rules are evaluated before the chat paints (no flash) and re-checked on client-side route changes, so they work on single-page apps. It's configured per channel in the dashboard — there is no script-tag attribute or prop for it. A channel with no rules shows everywhere.

### Appear after scrolling (floating only, advanced)

On pages where the floating bar shows, you can hold it back until the visitor scrolls past a specific element instead of using the fixed `data-appear-delay` timer — handy when the bar would otherwise overlap an above-the-fold hero.

Configured per channel in the dashboard as **appear-after** rules, alongside the visibility rules. Each rule is a URL pattern (same glob dialect as visibility) plus a **CSS selector** on your page:

- On a matching path, the bar stays hidden until that element is scrolled above the top of the viewport, then slides in.
- It's **reactive** — scroll back up and the bar hides again, so it never re-collides with the element.
- Paths with no matching rule keep the default `data-appear-delay` behavior.
- These rules are independent of show/hide: adding one never changes *whether* the bar appears on a page, only *when*. A hidden page stays hidden.
- If the selector matches nothing on the page, the bar fails open (shows) rather than staying hidden.

Example: on `/`, hold the bar until the visitor scrolls past `#hero`. Everywhere else, the timer applies as usual.

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

### Theming the chat widget

Theming is opt-in via `data-theme` on the script tag (or `appearance.theme` on the React component). Without it, the widget renders into whatever container you give it, with no chrome assumed — exactly like a bare React component you'd drop into your own layout. Set `data-theme` and you get an opinionated card look plus a light/dark/auto preset.

Themes layer cheapest → richest:

1. **Pick a preset** — `light`, `dark`, or `auto` (follow `prefers-color-scheme`). Without one, no chrome is applied.
2. **Override CSS variables** on the container — for ad-hoc colour or radius tweaks, write plain CSS
3. **Pass `appearance.variables`** programmatically — for tweaks that depend on JS state

#### 1. Theme presets

Set the preset via `data-theme` on the script tag, or via `appearance.theme` on the React component:

```html
<!-- Script tag -->
<div data-waniwani-embed></div>
<script src="…/embed.js" data-token="wwp_..." data-theme="light"></script>
```

```tsx
// React
<WaniwaniChat
  token="wwp_..."
  channelId="..."
  overrides={{ appearance: { theme: "auto" } }}
/>
```

`auto` follows the OS / browser dark-mode setting at runtime — no reload needed when the user flips it.

#### Container defaults (inline mode)

The inline embed injects these low-specificity rules on `[data-waniwani-embed]`:

```css
/* Always — so a bare snippet is bounded out of the box */
:where([data-waniwani-embed]) { height: 500px; }

/* Only when `data-theme` is set — the card look on YOUR container */
:where([data-waniwani-embed]) { border-radius: 16px; overflow: hidden; }

/* Only on a container the embed AUTO-CREATES (no markup on the page) */
:where([data-waniwani-embed][data-waniwani-auto]) {
  width: 100%;
  max-width: 28rem;        /* centered card, not full-width */
  margin-inline: auto;
  border-radius: 16px;
  overflow: hidden;
  border: 1px solid var(--ww-border, rgba(0, 0, 0, 0.1));
  box-shadow: var(--ww-shadow, 0 10px 30px rgba(0, 0, 0, 0.08));
}
```

The card styling only applies to a container the embed creates for you — when you place your own `[data-waniwani-embed]`, the embed leaves its width/shape alone.

##### Restyle the auto-created card — no markup required

You don't need to add a `[data-waniwani-embed]` element to restyle the card. The container the embed creates lives in your page's light DOM with the `data-waniwani-embed` attribute, so your own page CSS targets it directly. All the embed defaults are `:where()` (specificity 0), so any normal rule wins:

```html
<style>
  [data-waniwani-embed] {
    /* size & shape — plain CSS on the container */
    height: 600px;
    max-width: 32rem;     /* default ≈28rem; use `none` for full width */
    border-radius: 20px;

    /* colors — `--ww-*` variables pierce the chat's shadow DOM */
    --ww-bg: #111827;
    --ww-text: #e5e7eb;
    --ww-primary: #22d3ee;
    --ww-border: #334155;
  }
</style>
<script src="…/embed.js" defer data-token="wwp_..."></script>
```

- **Size & shape** (`height`, `max-width`, `border-radius`, `border`, `box-shadow`, `margin`) — set them as normal CSS properties on `[data-waniwani-embed]`.
- **Colors, radius, fonts inside the chat** — set any `--ww-*` variable (see [CSS variable overrides](#2-css-variable-overrides) for the full list). These inherit through the Shadow DOM, so you can set them on `[data-waniwani-embed]`, or globally on `:root` / `body` to theme every embed on the page at once.

Place your own `[data-waniwani-embed]` element only when you want to control *where* the chat mounts or drop it into an existing layout (a flex/grid cell, a sidebar, etc.).

Both are wrapped in `:where()` (specificity `0,0,0`), so **any** normal rule targeting `[data-waniwani-embed]` wins. Examples:

```css
/* Smaller card */
[data-waniwani-embed] { height: 300px; }

/* Shrink-to-content, capped — opt out of the fixed height */
[data-waniwani-embed] { height: auto; max-height: 600px; }

/* Rectangular, no clipping */
[data-waniwani-embed] { border-radius: 0; }

/* Inside a flex column where the chat should shrink with the parent */
[data-waniwani-embed] { height: auto; flex: 1; min-height: 0; }
```

Leave `data-theme` off and the container keeps its square shape (no rounding) — only the 500px default height is applied, which you can override as above.

#### 2. CSS variable overrides

The widget exposes a `--ww-*` namespace that pierces the shadow boundary. Set any of these on the container in plain CSS:

```html
<style>
  [data-waniwani-embed] {
    --ww-primary: #ff6b6b;
    --ww-radius: 8px;
    --ww-font: "Inter", sans-serif;
  }
</style>
<div data-waniwani-embed></div>
```

Unset variables fall back to the preset's defaults, so you only override what you care about. This works for both light and dark presets — your `--ww-primary: red` wins in both modes.

| CSS Variable | Property | Default (light) | Default (dark) |
|--------------|----------|-----------------|----------------|
| `--ww-primary` | Primary brand colour | `#6366f1` | `#6366f1` |
| `--ww-primary-fg` | Text on primary | `#1f2937` | `#ffffff` |
| `--ww-bg` | Panel background | `#ffffff` | `#212121` |
| `--ww-text` | Default text colour | `#1f2937` | `#ececec` |
| `--ww-muted` | Secondary text | `#6b7280` | `#8e8ea0` |
| `--ww-border` | Border colour | `#e5e7eb` | `#444444` |
| `--ww-assistant-bubble` | Assistant bubble bg | `#f3f4f6` | `#2f2f2f` |
| `--ww-assistant-bubble-text` | Assistant bubble text | `#1f2937` | `#ececec` |
| `--ww-user-bubble` | User bubble bg | `#f4f4f4` | `#303030` |
| `--ww-user-bubble-text` | User bubble text | `#1f2937` | `#ffffff` |
| `--ww-input-bg` | Input field bg | `#f9fafb` | `#2f2f2f` |
| `--ww-header-bg` | Header background | `#ffffff` | `#1e1e1e` |
| `--ww-header-text` | Header text | `#1f2937` | `#ececec` |
| `--ww-status` | Status dot | `#22c55e` | `#22c55e` |
| `--ww-tool-card` | Tool call card bg | `#f4f4f5` | `#262626` |
| `--ww-radius` | Panel border-radius | `16px` | `16px` |
| `--ww-msg-radius` | Message bubble radius | `8px` | `8px` |
| `--ww-msg-pad-x` | Message bubble padding X | `16px` | `16px` |
| `--ww-msg-pad-y` | Message bubble padding Y | `12px` | `12px` |
| `--ww-msg-max-width` | Message bubble max width | `80%` | `80%` |
| `--ww-font` | Font family | system stack | system stack |
| `--ww-font-size` | Base message font size | `1rem` | `1rem` |
| `--ww-line-height` | Base message line height | `1.5` | `1.5` |

#### 3. Programmatic `appearance`

For JS-driven theming, pass an `appearance` object. Same shape on every surface:

```js
// embed.js
window.WaniWani.chat.init({
  token: "wwp_...",
  appearance: {
    theme: "dark",
    variables: { primaryColor: "#ff6b6b", borderRadius: 8 },
  },
});
```

```tsx
// React
<WaniwaniChat
  token="wwp_..."
  channelId="..."
  overrides={{
    appearance: {
      theme: "dark",
      variables: { primaryColor: "#ff6b6b", borderRadius: 8 },
    },
  }}
/>
```

`variables` accepts the same keys as `ChatTheme`. The helpers `DEFAULT_THEME`, `DARK_THEME`, and `mergeTheme(base, overrides)` are exported from `@waniwani/sdk/chat` for assembling custom variable sets.

#### 4. Assistant message bubble (opt-in)

Assistant replies render as plain text by default. Turn them into filled bubbles — styled by `assistantBubbleColor` / `assistantBubbleTextColor`, sharing the user bubble's radius and padding — with `assistantBubble`:

```js
// embed.js
window.WaniWani.chat.init({
  token: "wwp_...",
  appearance: {
    assistantBubble: true,
    variables: { assistantBubbleColor: "#e6f2f2", assistantBubbleTextColor: "#0b2b2e" },
  },
});
```

```html
<!-- script tag -->
<script src="…/embed.js" data-token="wwp_..." data-assistant-bubble="true"></script>
```

```tsx
// React
<WaniwaniChat
  token="wwp_..."
  channelId="..."
  overrides={{ appearance: { assistantBubble: true } }}
/>
```

Leave it unset (the default) and assistant messages stay bubble-less — existing widgets are unchanged.

#### 5. Deep customization — per-slot classes

Tokens cover colours, typography, and bubble shape. To restyle an element beyond what a token exposes, target it directly.

**React** — pass `classNames` (type `ChatClassNames`). Each string is merged onto that slot:

```tsx
<WaniwaniChat
  token="wwp_..."
  channelId="..."
  overrides={{
    classNames: {
      root: "my-chat",
      header: "ww:uppercase ww:tracking-wide",
      userBubble: "ww:shadow-md",
      input: "ww:ring-2 ww:ring-[#0a6c74]",
    },
  }}
/>
```

Slots: `root`, `header`, `message`, `userBubble`, `assistantBubble`, `input`.

**Script embed** — the widget renders in a Shadow DOM, so your page's own selectors cannot reach inside. Two supported paths in:

1. Set `--ww-*` variables (they inherit through the boundary) — see the table above.
2. Inject a full stylesheet with `data-css` and target the stable semantic classes:

```html
<script
  src="…/embed.js"
  data-token="wwp_..."
  data-css="https://your.site/widget.css"
></script>
```

```css
/* widget.css — loaded into the widget's Shadow DOM */
.ww-header { letter-spacing: 0.02em; }
.ww-input { box-shadow: 0 0 0 2px rgba(10, 108, 116, 0.25); }
.ww-message-user .ww-bubble { box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1); }
.ww-message-assistant .ww-bubble { border: 1px solid #0a6c74; }
```

Stable hooks: `.ww-message`, `.ww-message-user`, `.ww-message-assistant`, `.ww-bubble`, `.ww-header`, `.ww-input`. These are guaranteed selectors — the internal `ww:`-prefixed Tailwind classes are not.

#### What is not themeable

To set expectations for a full rebrand, these are intentionally fixed today:

- **Typographic scale beyond the base** — `fontSize` / `lineHeight` set the message base; per-heading sizes inside markdown and built-in label sizes/weights are not individually exposed.
- **Chrome corner radii** — `messageBorderRadius` shapes message bubbles only; tool-call cards, the chain-of-thought accordion, menus, and welcome-screen buttons keep their fixed radii.
- **Floating launcher accent** — the dock's animated border-glow uses a fixed accent gradient.
- **"Powered by" mark** — the footer logo is not removable via theming.

For anything in this list, reach out — some are candidates for future tokens.

### Event tracking

`WaniwaniChat` and the `<script>` embed automatically emit one event on init:

| Event | Trigger | Identity |
|-------|---------|----------|
| `page.viewed` | Widget initializes on the host page (once per load) | Anonymous `visitorId` — **no session** |

This is the top of the funnel: it counts everyone who *landed* on a page where the widget is present, regardless of whether they ever open it or send a message. It is attributed to the anonymous `visitorId` (the backend maps it to `externalUserId`) and deliberately carries **no `sessionId`** — a session is only created when a conversation actually starts (on the first message). That separation is what lets the funnel compute "page views vs conversations started"; minting a session per page view would make the two equal and collapse the funnel. See [events.md](./events.md) for the event taxonomy and the anonymous-visitor identity model.

The event goes to the same canonical ingest every other event uses (`POST /api/mcp/events/v2/batch`, the V2 batch envelope), authenticated with the same public `wwp_...` token the widget already uses for `/chat` and `/config` (no API key, no separate JWT in the browser). Tracking is fire-and-forget — failures never break the chat.

**Surface attribution.** Every event the widget produces carries `properties.mode`, the embed surface it came from: `"floating"` for the floating bar, `"inline"` for an in-page mount (`<WaniwaniChat>` or the inline `<script>` embed). `page.viewed` sets it directly; chat requests send the same value with every turn, so the server-logged `chat.user_message` and `chat.assistant_message` events carry it too. Use it to slice analytics by surface, for example floating-bar conversations vs inline ones on the same channel.

**Opting out.** On surfaces where a page view is meaningless — an already-authenticated app shell, an internal tool, a staging preview — suppress the event so it doesn't inflate the customer's funnel. Set `overrides={{ disablePageView: true }}` on `<WaniwaniChat>`, or `data-disable-page-view="true"` (a bare `data-disable-page-view` works too) on the `<script>` embed. The rest of the widget is unaffected; only the `page.viewed` event is skipped.

### Tracking from the host page (`chat.track`)

The chat surfaces expose the SDK's typed `track` client to the host page, riding the same public `wwp_` token and channel the chat itself uses. Identity is automatic: events carry the server-assigned chat `sessionId` once the first exchange creates one, and the anonymous `visitorId` before that.

With the `<script>` embed, `track` and `identify` live on the global:

```html
<script>
  document.querySelector("#buy").addEventListener("click", () => {
    WaniWani.chat.track.converted({ amount: 85, currency: "EUR" });
  });

  // When your page knows who the user is:
  WaniWani.chat.identify("user_123", { plan: "pro" });
</script>
```

With `<WaniwaniChat>`, the same surface lives on the `ChatHandle` ref:

```tsx
const chat = useRef<ChatHandle>(null);

<WaniwaniChat ref={chat} token="wwp_..." channelId="..." />
<button onClick={() => chat.current?.track?.optionSelected({ id: "pro", amount: 49, currency: "EUR" })}>
  Choose Pro
</button>
```

`track` is the same `TrackFn` as everywhere else: callable with a typed event (`track({ event: "link.clicked", properties: { url } })`) plus the flat revenue helpers. `track` and `identify` are **absent on the bare `ChatEmbed`** primitive, which holds no Waniwani credential. See [events.md](./events.md) for the taxonomy.

## `ChatEmbed` (advanced)

**Most apps should use `WaniwaniChat` or the `<script>` embed.** `ChatEmbed` is the bare-bones primitive underneath both of them: no token, no remote config, no defaults, no built-in MCP resource endpoint. You wire up `api`, `headers`, `body`, `theme`, and (optionally) `mcp` yourself.

Reach for it when you self-host the chat backend (your own Next.js/Express route, your own provider) and don't want Waniwani's hosted features.

```tsx
import { ChatEmbed } from "@waniwani/sdk/chat";

// Self-hosted chat endpoint
<ChatEmbed
  api="/api/my-chat-endpoint"
  body={{ environmentId, sessionId }}
  appearance={{ theme: "dark" }}
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

Plus all shared `ChatBaseProps` (`headers`, `body`, `appearance`, `welcomeMessage`, `welcome`, `placeholder`, `suggestions`, `allowAttachments`, `enableThreadHistory`, `showToolCalls`, `onMessageSent`, `onResponseReceived`, `onCallTool`, `debug`, `triggerEvent`).

The same `ChatHandle` ref API works on `ChatEmbed`. See [Imperative handle](#imperative-handle) above.

## Additional components

- **`McpAppFrame`** — Renders MCP App widget iframes inside chat. Forwards tool result `_meta` via `ui/notifications/tool-result` for widget tracking config.

## Common mistakes

- **Wrong import path** — Use `@waniwani/sdk/chat`, not `@waniwani/sdk`
- **Missing stylesheet** — Import `@waniwani/sdk/chat/styles.css` alongside the component
- **Missing peer deps** — Requires `react`, `react-dom`, `@ai-sdk/react`, and `ai`. Everything else is bundled.
- **Embed cleanup** — Always call `chat.destroy()` (or unmount the React tree) to prevent memory leaks
- **Shadow DOM styling** — The `<script>` embed uses Shadow DOM, so most external CSS won't reach the widget. CSS custom properties (`--ww-*`) are the exception — they cascade through the shadow boundary, so setting them on `[data-waniwani-embed]` is the simplest way to theme the widget from plain CSS. For finer-grained control, pass `appearance` programmatically.
- **Using `ChatEmbed` when `WaniwaniChat` would do** — `ChatEmbed` is the BYO-backend primitive; if you're talking to `app.waniwani.ai`, `WaniwaniChat` is the right choice.
