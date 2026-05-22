// Legacy MCP-widget-in-host React hooks. Re-exported from
// `@waniwani/sdk/mcp/react` for back-compat. New code should not use these.

export type {
	ModelContextContentBlock,
	ModelContextUpdate,
} from "../../../../shared/model-context";
// Types
export type * from "./@types";
export type { UnstableSendFollowUpWithGhostGuardResult } from "./unstable-use-send-follow-up";
export { unstable_useSendFollowUpWithGhostGuard } from "./unstable-use-send-follow-up";
export { useCallTool } from "./use-call-tool";
export { useDisplayMode } from "./use-display-mode";
export type { FlowActionResult } from "./use-flow-action";
export { useFlowAction } from "./use-flow-action";
export { useIsChatGptApp } from "./use-is-chatgpt-app";
export { useLocale } from "./use-locale";
export { useMaxHeight } from "./use-max-height";
// Action hooks
export { useOpenExternal } from "./use-open-external";
export { useRequestDisplayMode } from "./use-request-display-mode";
export { useSafeArea } from "./use-safe-area";
export type { SendFollowUpOptions } from "./use-send-follow-up";
export { useSendFollowUp } from "./use-send-follow-up";
export { useTheme } from "./use-theme";
// Data hooks
export { useToolOutput } from "./use-tool-output";
export { useToolResponseMetadata } from "./use-tool-response-metadata";
export { useUpdateModelContext } from "./use-update-model-context";
export { useWidgetClient, WidgetProvider } from "./use-widget";
// State hooks
export { useWidgetState } from "./use-widget-state";
