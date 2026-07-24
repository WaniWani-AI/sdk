"use client";

/**
 * Shared widget-client context, owned and consumed exclusively by the legacy
 * `WidgetProvider` (`src/legacy/mcp/react/hooks/use-widget.ts`) and
 * `unstable-use-send-follow-up`. `useWaniwani` resolves config from explicit
 * options or the `toolResponseMetadata` passed to it and does not read this
 * context.
 *
 * Kept at this path for back-compat with legacy imports; it belongs in
 * `src/legacy/` and may move there in a future cleanup.
 */

import { createContext } from "react";
import type { UnifiedWidgetClient } from "../../legacy/mcp/react/widgets/widget-client";

export const WidgetClientContext = createContext<UnifiedWidgetClient | null>(
	null,
);
