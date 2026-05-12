// Legacy MCP-widget React surface. Mounted at `@waniwani/sdk/legacy/react`
// and re-exported from `@waniwani/sdk/mcp/react` for back-compat.
//
// The MCP-widget-in-host pattern (createResource + createTool + WidgetProvider
// + the host bridge hooks) is no longer the recommended way to build new code.
// Use `createFlow` from `@waniwani/sdk/mcp` instead. These exports stay alive
// indefinitely for the ~14 customer MCPs already on this stack.

// Components
export { InitializeNextJsInIframe } from "./components/initialize-next-in-iframe";
// Dev tools
export {
	DevModeProvider,
	getMockState,
	initializeMockOpenAI,
	updateMockDisplayMode,
	updateMockGlobal,
	updateMockTheme,
	updateMockToolOutput,
} from "./dev/index";
// Client-side types
export type {
	DeviceType,
	DisplayMode,
	SafeArea,
	SafeAreaInsets,
	Theme,
	UnknownObject,
	UserAgent,
} from "./hooks/@types";
// Hooks
export type {
	FlowActionResult,
	ModelContextContentBlock,
	ModelContextUpdate,
	SendFollowUpOptions,
} from "./hooks/index";
export {
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
} from "./hooks/index";
export { LoadingWidget } from "./widgets/loading-widget";
// Platform detection
export type { WidgetPlatform } from "./widgets/platform";
export { detectPlatform, isMCPApps, isOpenAI } from "./widgets/platform";
// Widget client types
export type {
	HostContext,
	ToolCallResult,
	ToolResult,
	UnifiedWidgetClient,
} from "./widgets/widget-client";
