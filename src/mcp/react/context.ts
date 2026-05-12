"use client";

/**
 * Shared widget-client context.
 *
 * The context value is owned by the legacy `WidgetProvider`
 * (`src/legacy/mcp/react/hooks/use-widget.ts`), but `useWaniwani` reads it
 * opportunistically to auto-discover its config when a widget is mounted
 * inside a legacy MCP-widget host. Outside that legacy host, the context
 * value is `null` and `useWaniwani` falls back to explicit options.
 *
 * Lives in non-legacy because non-legacy code (`useWaniwani`) reads it. Legacy
 * code crosses the boundary to import it, which is allowed.
 */

import { createContext } from "react";
import type { UnifiedWidgetClient } from "../../legacy/mcp/react/widgets/widget-client";

export const WidgetClientContext = createContext<UnifiedWidgetClient | null>(
	null,
);
