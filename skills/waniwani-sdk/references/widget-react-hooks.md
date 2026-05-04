# Widget React Hooks (`@waniwani/sdk/mcp/react`)

Client-side hooks for widget frontends. All widgets must be wrapped in `WidgetProvider`.

## Import

```tsx
import { WidgetProvider, useToolOutput, useTheme } from "@waniwani/sdk/mcp/react";
```

Peer dependencies: `react`, optionally `@modelcontextprotocol/ext-apps`

## `WidgetProvider` (REQUIRED)

**Every widget page MUST wrap its content in `WidgetProvider`.** Without it, all hooks (`useToolOutput`, `useTheme`, etc.) will throw:

```
Uncaught Error: useWidgetClient must be used within a WidgetProvider
```

The page component itself must NOT call any hooks. It is only a thin shell that renders `WidgetProvider` around a child component. All hook usage goes in the child component.

```tsx
// CORRECT: page.tsx is a thin wrapper, hooks are in the child component
"use client";
import { WidgetProvider } from "@waniwani/sdk/mcp/react";
import { MyWidget } from "@/lib/widgets/my-widget";

export default function MyWidgetPage() {
  return (
    <WidgetProvider loading={<div>Loading...</div>}>
      <MyWidget />
    </WidgetProvider>
  );
}
```

```tsx
// WRONG: calling hooks directly in the page without WidgetProvider
"use client";
import { useToolOutput } from "@waniwani/sdk/mcp/react";

export default function MyWidgetPage() {
  const data = useToolOutput(); // THROWS: useWidgetClient must be used within a WidgetProvider
  return <div>{JSON.stringify(data)}</div>;
}
```

## `InitializeNextJsInIframe`

Patches Next.js so the app works correctly inside a cross-origin iframe (ChatGPT sandbox, Claude MCP Apps, embed proxy). Must be rendered in the root layout's `<head>`.

**What it patches:**
- `history.pushState` / `replaceState` -- prevents cross-origin URL errors in sandboxed iframes
- `window.fetch` -- rewrites *relative* same-origin requests to the widget's real `baseUrl` so relative `/api/...` calls don't 404. Absolute URLs (string with scheme, `URL`, `Request`) are left alone, so SDK transports can hit the WaniWani API even when it shares an origin with the iframe.
- `<html>` attribute observer -- strips host-injected attributes while preserving `class`/`style`/`lang`

```tsx
// app/layout.tsx (or app/widgets/layout.tsx)
import { InitializeNextJsInIframe } from "@waniwani/sdk/mcp/react";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <InitializeNextJsInIframe baseUrl={process.env.NEXT_PUBLIC_BASE_URL!} />
      </head>
      <body>{children}</body>
    </html>
  );
}
```

**Props:**

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `baseUrl` | `string` | Yes | The widget app's canonical URL (e.g. `https://my-app.com`) |
| `passthroughOrigins` | `string[]` | No | Origins whose *relative-URL* fetches skip the rewrite. Absolute URLs are never rewritten, so most callers don't need this. |

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
| `useSendFollowUp()` | `(prompt, options?) => void` | Both |
| `useSafeArea()` | `SafeArea \| null` | OpenAI only (`null` on MCP Apps) |
| `useMaxHeight()` | `number \| null` | OpenAI only (`null` on MCP Apps) |
| `useWidgetState<T>(default?)` | `[T \| null, setState]` | OpenAI only (`[null, no-op]` on MCP Apps) |
| `useToolResponseMetadata()` | `object \| null` | Both |
| `useIsChatGptApp()` | `boolean` | OpenAI only |
| `useWaniwani(options?)` | `WaniwaniWidget` | Both |
| `useWidgetClient()` | `UnifiedWidgetClient` | Both |
| `useFlowAction<T>()` | `FlowActionResult<T>` | Both |
| `useUpdateModelContext()` | `(context: ModelContextUpdate) => Promise<void>` | Both |

## Example Widget

```tsx
"use client";
import { WidgetProvider, useToolOutput, useTheme } from "@waniwani/sdk/mcp/react";

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

## `useWaniwani` -- Automatic Event Tracking

Auto-captures user interactions from widget UIs and provides manual tracking methods for custom events. Events are sent directly to the WaniWani backend using a JWT token injected by `withWaniwani` on the server side.

```tsx
import { useWaniwani } from "@waniwani/sdk/mcp/react";

function MyWidget() {
  const wani = useWaniwani();
  // Auto-captures clicks, link clicks, errors, scrolls, form interactions
  // Optionally call wani.track("custom_event") for manual events
  return <a href="https://example.com">Visit site</a>;
}
```

**Options:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `token` | `string` | auto-resolved | JWT widget token |
| `endpoint` | `string` | auto-resolved | Batch endpoint URL |
| `sessionId` | `string` | auto-resolved | Session correlation ID |
| `metadata` | `Record<string, unknown>` | -- | Extra metadata merged into every event |

All options auto-resolve from `WidgetProvider` context when `withWaniwani` is configured on the server. Explicit values override auto-resolved ones. Falls back to a silent no-op when no config is available.

**Returns:** `WaniwaniWidget`

| Method | Description |
|--------|-------------|
| `identify(userId, traits?)` | Tie subsequent events to a user |
| `step(name, meta?)` | Record a funnel step (auto-incrementing sequence) |
| `track(event, properties?)` | Record a custom event |
| `conversion(name, data?)` | Record a conversion event |

**Auto-captured events:**

| Event | Trigger |
|-------|---------|
| `widget_render` | On init -- viewport, device info |
| `widget_click` | Capture-phase click on `document` |
| `widget_link_click` | Click on `<a>` -- href, text, is_external |
| `widget_error` | `window.error` + `unhandledrejection` |
| `widget_scroll` | Throttled scroll depth tracking |
| `widget_form_field` | focusin/focusout on inputs -- time in field |
| `widget_form_submit` | Form submit -- time to submit, validation errors |
| `conversion` | Click on element with `data-ww-conversion` attribute |
| `step` | Click on element with `data-ww-step` attribute |

## Declarative Data Attributes

Track conversions and funnel steps without calling methods. Add data attributes to any clickable element:

```html
<!-- Conversion: "name key:value key:value ..." -->
<button data-ww-conversion="purchase value:49.99 currency:EUR">Buy Now</button>
<button data-ww-conversion="signup">Sign Up Free</button>

<!-- Funnel step: "name key:value key:value ..." (auto-incrementing sequence) -->
<button data-ww-step="pricing">View Pricing</button>
<button data-ww-step="select-plan plan:premium">Select Plan</button>
```

First token is the event name, remaining `key:value` pairs become metadata. Numeric values are auto-coerced. Both use `closest()` so child element clicks bubble up correctly.

## Widget Page Pattern

**CRITICAL: The page component MUST wrap children in `WidgetProvider`. Never call hooks directly in the page -- they will throw.** Keep the page as a thin wrapper. All widget logic belongs in a separate component file rendered inside `WidgetProvider`.

```tsx
// app/widgets/pricing/page.tsx -- thin wrapper with WidgetProvider
"use client";
import { WidgetProvider } from "@waniwani/sdk/mcp/react";
import { PricingWidget } from "@/lib/widgets/pricing";

export default function PricingPage() {
  return (
    <WidgetProvider loading={<div>Loading...</div>}>
      <PricingWidget />
    </WidgetProvider>
  );
}
```

```tsx
// lib/widgets/pricing.tsx -- all hook usage here, inside WidgetProvider
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

## Dev Tools

For local development without a ChatGPT or Claude host environment:

```tsx
import { DevModeProvider } from "@waniwani/sdk/mcp/react";

<DevModeProvider defaultProps={{ plan: "pro", amount: 49 }}>
  <MyWidget />
</DevModeProvider>
```

Programmatic mock updates are available via `initializeMockOpenAI()`, `updateMockToolOutput()`, `updateMockTheme()`, `updateMockDisplayMode()`, and `updateMockGlobal()`.

## Common Mistakes

- **Calling hooks in the page component without `WidgetProvider`** -- This is the #1 error. The page component must ONLY render `<WidgetProvider>` around a child component. All `useToolOutput`, `useTheme`, etc. calls go in the child. Without this, you get: `Uncaught Error: useWidgetClient must be used within a WidgetProvider`.
- **Wrong import path** -- Hooks come from `@waniwani/sdk/mcp/react`, not `@waniwani/sdk`.
- **Missing `InitializeNextJsInIframe` in layout** -- Without it, fetch calls 404 and navigation breaks inside cross-origin iframes (ChatGPT, Claude, embed proxy).
- **Assuming all hooks work everywhere** -- `useSafeArea`, `useMaxHeight`, and `useWidgetState` return `null`/no-op on MCP Apps (Claude).
