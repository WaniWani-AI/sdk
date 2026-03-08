// Client-side React hooks and components for MCP widgets

export type { FlowWidgetRegistry } from "./components/flow-widget";
// Components
export { FlowWidget } from "./components/flow-widget";
export { InitializeNextJsInChatGpt } from "./components/initialize-next-in-chat-gpt";
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
// Hooks and provider
export type {
	FlowActionResult,
	UseWaniwaniOptions,
	WaniwaniWidget,
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
	useWaniwani,
	useWidgetClient,
	useWidgetState,
	WidgetProvider,
} from "./hooks/index";
export { LoadingWidget } from "./widgets/loading-widget";
