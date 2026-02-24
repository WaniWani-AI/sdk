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
| `useToolResponseMetadata()` | `object \| null` | OpenAI only |
| `useIsChatGptApp()` | `boolean` | OpenAI only |
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
