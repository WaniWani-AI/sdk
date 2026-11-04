// Non-legacy MCP React hooks. Currently only `useWaniwani` (standalone
// tracking hook). The legacy widget-host bridge hooks (`useWidgetClient`,
// `useToolOutput`, etc.) live in `src/legacy/mcp/react/hooks/`.

export type { UseWaniwaniOptions, WaniwaniWidget } from "./use-waniwani";
export { useWaniwani } from "./use-waniwani";
