// `@waniwani/sdk/mcp/react` entry point.
//
// `useWaniwani` — the standalone tracking hook. Host-agnostic: it takes the
// tool-response `_meta` as data, opens no host connection, and reads no
// provider context. Skybridge-hosted widgets use the adapter at
// `@waniwani/sdk/mcp/react/skybridge` instead of calling this directly.

export type { UseWaniwaniOptions, WaniwaniWidget } from "./hooks/index";
export { useWaniwani } from "./hooks/index";
