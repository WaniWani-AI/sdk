"use client";

// `@waniwani/sdk/mcp/react/skybridge` — the skybridge-host adapter for
// `useWaniwani`.
//
// The pure `@waniwani/sdk/mcp/react` hook is host-agnostic: it takes the tool
// response `_meta` as data and never opens a host connection of its own. That
// keeps the core dependency-free, but it means the widget author has to hand
// the metadata in.
//
// On an MCP-Apps host the tool result `_meta` is delivered once, as the
// `ui/notifications/tool-result` notification, to whichever `App` is connected
// and listening at that moment. In a skybridge widget that App is skybridge —
// it captures the result and exposes it as `useToolInfo().responseMetadata`.
// This adapter reads that value and feeds it to the core hook, so widgets get
// the full tracking surface from a bare call:
//
// ```tsx
// import { useWaniwani } from "@waniwani/sdk/mcp/react/skybridge";
//
// function BookCallWidget() {
//   const wani = useWaniwani();
//   wani.track.leadQualified({ email, name });
// }
// ```
//
// skybridge is an optional peer dependency, resolved in the consumer app. The
// SDK depends only on the tiny slice declared in `skybridge-web.d.ts`, so it
// need not install skybridge to typecheck or build.

import { useToolInfo } from "skybridge/web";
import {
	type UseWaniwaniOptions,
	useWaniwani as useWaniwaniCore,
	type WaniwaniWidget,
} from "./hooks/use-waniwani";

/**
 * Options for the skybridge `useWaniwani` adapter. Derived from the core hook's
 * metadata-driven options (the `endpoint?: undefined` branch of
 * {@link UseWaniwaniOptions}) minus the two fields the adapter supplies itself:
 * `endpoint`/`source` and `token`/`sessionId` are resolved from skybridge's
 * `responseMetadata` (`_meta["waniwani/widget"]`), and `toolResponseMetadata` is
 * read from `useToolInfo()`. What remains — `source`/`token`/`sessionId`
 * overrides and `metadata` passthrough — keeps its field docs from the core.
 */
export type SkybridgeWaniwaniOptions = Omit<
	Extract<UseWaniwaniOptions, { endpoint?: undefined }>,
	"endpoint" | "toolResponseMetadata"
>;

export type { WaniwaniWidget } from "./hooks/use-waniwani";

/**
 * `useWaniwani` for skybridge-hosted MCP-app widgets. Resolves the Waniwani
 * config from skybridge's `useToolInfo().responseMetadata` and returns the same
 * `track` surface as the core hook, with session identity stamped
 * automatically. Call it bare — no config threading, no provider.
 *
 * @example
 * ```tsx
 * const wani = useWaniwani();
 * wani.track.optionSelected({ id: "pro", amount: 49, currency: "EUR" });
 * ```
 */
export function useWaniwani(
	options: SkybridgeWaniwaniOptions = {},
): WaniwaniWidget {
	const { responseMetadata } = useToolInfo();
	return useWaniwaniCore({
		...options,
		toolResponseMetadata: responseMetadata,
	});
}
