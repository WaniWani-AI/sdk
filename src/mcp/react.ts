// Client-side React hooks and components for MCP widgets

// Components
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
export {
	useCallTool,
	useDisplayMode,
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
	useWidgetClient,
	useWidgetState,
	WidgetProvider,
} from "./hooks/index";
export { LoadingWidget } from "./widgets/@utils/loading-widget";
