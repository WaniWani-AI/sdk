// `@waniwani/sdk/mcp/react` entry point.
//
// Non-legacy: `useWaniwani` (standalone tracking hook) — see ./hooks/index.ts.
// Legacy: everything else (MCP-widget-in-host bridge) — re-exported from
// `src/legacy/mcp/react` for back-compat. New code should depend on
// `@waniwani/sdk/legacy/react` for the legacy bits.

// Legacy — re-exported from src/legacy/mcp/react
export type {
	DeviceType,
	DisplayMode,
	FlowActionResult,
	HostContext,
	ModelContextContentBlock,
	ModelContextUpdate,
	SafeArea,
	SafeAreaInsets,
	SendFollowUpOptions,
	Theme,
	ToolCallResult,
	ToolResult,
	UnifiedWidgetClient,
	UnknownObject,
	UserAgent,
	WidgetPlatform,
} from "../../legacy/mcp/react";
export {
	DevModeProvider,
	detectPlatform,
	getMockState,
	InitializeNextJsInIframe,
	initializeMockOpenAI,
	isMCPApps,
	isOpenAI,
	LoadingWidget,
	updateMockDisplayMode,
	updateMockGlobal,
	updateMockTheme,
	updateMockToolOutput,
	useCallTool,
	useDisplayMode,
	useFlowAction,
	useIsChatGptApp,
	useLocale,
	useMaxHeight,
	useOpenExternal,
	useRequestDisplayMode,
	useSafeArea,
	useSendFollowUp,
	useTheme,
	useToolOutput,
	useToolResponseMetadata,
	useUpdateModelContext,
	useWidgetClient,
	useWidgetState,
	WidgetProvider,
} from "../../legacy/mcp/react";
// Non-legacy
export type { UseWaniwaniOptions, WaniwaniWidget } from "./hooks/index";
export { useWaniwani } from "./hooks/index";
