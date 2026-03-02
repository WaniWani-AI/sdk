# MCP React Hooks (`@waniwani/sdk/mcp/react`)

Client-side hooks for widget frontends. All widgets must be wrapped in `WidgetProvider`.

## Import

```tsx
import { WidgetProvider, useToolOutput, useTheme } from "@waniwani/sdk/mcp/react";
```

Peer dependencies: `react`, optionally `@modelcontextprotocol/ext-apps`

## `WidgetProvider`

```tsx
import { WidgetProvider } from "@waniwani/sdk/mcp/react";

export default function App() {
  return (
    <WidgetProvider loading={<div>Loading...</div>}>
      <MyWidget />
    </WidgetProvider>
  );
}
```

## Hooks Reference

| Hook | Returns | Platform |
|------|---------|----------|
| `useToolOutput<T>()` | `T \| null` | Both |
| `useCallTool()` | `(name, args) => Promise<ToolCallResult>` | Both |
| `useTheme()` | `"light" \| "dark"` | Both |
| `useLocale()` | `string` (e.g. `"en-US"`) | Both |
| `useDisplayMode()` | `"pip" \| "inline" \| "fullscreen"` | Both (MCP Apps: always `"inline"`) |
| `useRequestDisplayMode()` | `(mode) => Promise<DisplayMode>` | OpenAI only (no-op on MCP Apps) |
| `useOpenExternal()` | `(url) => void` | Both |
| `useSendFollowUp()` | `(prompt) => void` | Both |
| `useSafeArea()` | `SafeArea \| null` | OpenAI only (`null` on MCP Apps) |
| `useMaxHeight()` | `number \| null` | OpenAI only (`null` on MCP Apps) |
| `useWidgetState<T>(default?)` | `[T \| null, setState]` | OpenAI only (`[null, no-op]` on MCP Apps) |
| `useToolResponseMetadata()` | `object \| null` | Both (MCP Apps when host forwards tool `_meta`) |
| `useIsChatGptApp()` | `boolean` | OpenAI only |
| `useWaniwani(options?)` | `WaniwaniWidget` | Both |
| `useWidgetClient()` | `UnifiedWidgetClient` | Both |

## Example Widget

```tsx
"use client";
import {
  WidgetProvider,
  useToolOutput,
  useTheme,
} from "@waniwani/sdk/mcp/react";

function PricingContent() {
  const data = useToolOutput<{ plan: string; amount: number }>();
  const theme = useTheme();

  if (!data) return null;

  return (
    <div className={theme === "dark" ? "dark" : ""}>
      <h1>{data.plan} Plan</h1>
      <p>${data.amount}/mo</p>
    </div>
  );
}

export default function PricingWidget() {
  return (
    <WidgetProvider loading={<div>Loading pricing...</div>}>
      <PricingContent />
    </WidgetProvider>
  );
}
```

## Widget Page Rules

Every widget `page.tsx` in `app/({{MCP_NAME}})/` **must** wrap its content with `WidgetProvider`. Without it, all hooks will fail silently and the widget won't work.

The `page.tsx` should be a **thin wrapper only** — import the widget component and wrap it with `WidgetProvider`. **No business logic in `page.tsx`**. All widget logic, data fetching, and UI belongs in `lib/{{MCP_NAME}}/widgets/`.

```tsx
// app/(my-mcp)/widgets/pricing/page.tsx — THIN WRAPPER ONLY
"use client";
import { WidgetProvider } from "@waniwani/sdk/mcp/react";
import { PricingWidget } from "@/lib/my-mcp/widgets/pricing";

export default function PricingPage() {
  return (
    <WidgetProvider loading={<div>Loading...</div>}>
      <PricingWidget />
    </WidgetProvider>
  );
}
```

```tsx
// lib/my-mcp/widgets/pricing.tsx — ALL LOGIC HERE
"use client";
import { useToolOutput, useTheme } from "@waniwani/sdk/mcp/react";

export function PricingWidget() {
  const data = useToolOutput<{ plan: string; amount: number }>();
  const theme = useTheme();

  if (!data) return null;

  return (
    <div className={theme === "dark" ? "dark" : ""}>
      <h1>{data.plan} Plan</h1>
      <p>${data.amount}/mo</p>
    </div>
  );
}
```

## `useWaniwani` — Automatic Widget Event Tracking

Auto-captures user interactions (clicks, link clicks, errors, scrolls, form fields, form submits) from widget UIs. Also provides manual tracking methods for custom events.

Events are sent **directly to the WaniWani backend**. `withWaniwani` injects tracking config
under `_meta.waniwani` in tool responses (`endpoint` always, `token` when available, optional `sessionId`), and
`useWaniwani` auto-resolves it from `WidgetProvider` context. **No server-side proxy route needed.**

```tsx
import { useWaniwani } from "@waniwani/sdk/mcp/react";

function MyWidget() {
  const wani = useWaniwani();
  // Auto-captures clicks, link clicks, errors, scrolls, form interactions
  // Optionally call wani.track("custom_event") for manual events
  return <a href="https://example.com">Visit site</a>;
}
```

**Config resolution order:**
1. Explicit `endpoint` option (with optional `token` / `sessionId`)
2. Auto-resolved from `WidgetProvider` context (`toolResponseMetadata.waniwani`)
   MCP Apps hosts should forward tool result `_meta` in `ui/notifications/tool-result`
   so `toolResponseMetadata` is populated.
   The client accepts both `_meta` and `meta` payload keys for host compatibility.
3. Falls back to silent no-op if no config available

`useWaniwani` subscribes to `toolResponseMetadata` changes and will automatically
upgrade from no-op to live tracking when config arrives after initial render.
This handles MCP Apps hosts that deliver metadata asynchronously.
When explicit `endpoint` is provided, missing `token`/`sessionId` fields fall back
to context metadata when available.

**Options:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `token` | `string` | — | Optional JWT widget token (auto-resolved from context when available) |
| `endpoint` | `string` | — | V2 batch endpoint URL (auto-resolved from context if omitted) |
| `sessionId` | `string` | — | Optional session correlation ID (auto-resolved from context if omitted) |
| `metadata` | `Record<string, unknown>` | — | Extra metadata merged into every event |

**Returns:** `WaniwaniWidget`

| Method | Description |
|--------|-------------|
| `identify(userId, traits?)` | Tie subsequent events to a user |
| `step(name, meta?)` | Record a funnel step (auto-incrementing sequence) |
| `track(event, properties?)` | Record a custom event |
| `conversion(name, { value, currency, meta? })` | Record a revenue attribution event |

**Auto-captured events:**

| Event | Trigger |
|-------|---------|
| `widget_render` | On init — viewport, device info |
| `widget_click` | Capture-phase click on `document` |
| `widget_link_click` | Click on `<a>` — href, text, is_external |
| `widget_error` | `window.error` + `unhandledrejection` |
| `widget_scroll` | Throttled scroll depth tracking |
| `widget_form_field` | focusin/focusout on inputs — time in field |
| `widget_form_submit` | Form submit — time to submit, validation errors |
| `conversion` | Click on element with `data-ww-conversion` attribute |
| `step` | Click on element with `data-ww-step` attribute |

### Declarative Data Attributes

Track conversions and funnel steps without calling methods — add data attributes to any clickable element:

```html
<!-- Conversion: "name key:value key:value ..." -->
<button data-ww-conversion="purchase value:49.99 currency:EUR">Buy Now</button>
<button data-ww-conversion="signup">Sign Up Free</button>

<!-- Funnel step: "name key:value key:value ..." (auto-incrementing sequence) -->
<button data-ww-step="pricing">View Pricing</button>
<button data-ww-step="select-plan plan:premium">Select Plan</button>
```

First token is the event name, remaining `key:value` pairs become metadata. Numeric values are auto-coerced. `data-ww-conversion` defaults to `value:0 currency:USD` when omitted. Both use `closest()` so child clicks bubble up.

Requires `WidgetProvider` wrapper (for auto-resolving the JWT token from tool response metadata).

Lifecycle notes:
- `useWaniwani` uses a module-level singleton transport shared across hook consumers.
- Cleanup runs only when the **last** consumer unmounts, so one component unmounting does not stop tracking for others.
- The singleton is reinitialized when resolved tracking config changes
  (`endpoint`, `token`, or `sessionId`).

## Components

- **`InitializeNextJsInChatGpt`** — Required in Next.js layout for ChatGPT iframe compatibility. Takes `baseUrl` prop.
- **`LoadingWidget`** — Pre-built loading spinner for widget loading states.

## Dev Tools

For local development without a ChatGPT/Claude host:

```tsx
import { DevModeProvider } from "@waniwani/sdk/mcp/react";

// Wraps app, mocks window.openai for local testing
<DevModeProvider defaultProps={{ plan: "pro", amount: 49 }}>
  <MyWidget />
</DevModeProvider>
```

Programmatic mock updates: `initializeMockOpenAI()`, `updateMockToolOutput()`, `updateMockTheme()`, `updateMockDisplayMode()`, `updateMockGlobal()`.

## Theme-Aware Widget Pattern

```tsx
function MyWidget() {
  const theme = useTheme();
  return (
    <div style={{
      background: theme === "dark" ? "#1a1a1a" : "#ffffff",
      color: theme === "dark" ? "#ffffff" : "#000000",
    }}>
      {/* content */}
    </div>
  );
}
```

## Common Mistakes

- **Wrong import path** — Hooks come from `@waniwani/sdk/mcp/react`, not `@waniwani/sdk`
- **Missing `WidgetProvider`** — All hooks require the `WidgetProvider` wrapper
- **No `WidgetProvider` in `page.tsx`** — Every widget page must wrap its content with `WidgetProvider`, otherwise all hooks will fail
- **Business logic in `page.tsx`** — Keep `page.tsx` as a thin wrapper only. All widget logic belongs in `lib/{{MCP_NAME}}/widgets/`
- **Assuming all hooks work everywhere** — `useSafeArea`, `useMaxHeight`, `useWidgetState` return `null`/no-op on MCP Apps (Claude)
