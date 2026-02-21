// Server-side MCP framework

// Platform detection
export type { WidgetPlatform } from "./react/widgets/platform";
export { detectPlatform, isMCPApps, isOpenAI } from "./react/widgets/platform";
// Widget client types (for type-sharing between server and client)
export type {
	HostContext,
	ToolCallResult,
	ToolResult,
	UnifiedWidgetClient,
} from "./react/widgets/widget-client";
// Flow framework
export type {
	ConditionFn,
	FlowConfig,
	InterruptSignal,
	NodeConfig,
	NodeHandler,
	RegisteredFlow,
	WidgetSignal,
} from "./server/flows";
export {
	createFlow,
	END,
	interrupt,
	START,
	StateGraph,
	showWidget,
} from "./server/flows";
// Dynamic flows — AI-driven form gathering
export type {
	BooleanField,
	DynamicFlowConfig,
	FieldDefinition,
	NumberField,
	SelectField,
	TextField,
	WidgetField,
} from "./server/flows";
export { createDynamicFlow, field } from "./server/flows";
export type {
	RegisteredResource,
	ResourceConfig,
	WidgetCSP,
} from "./server/resources";
// Resources
export { createResource } from "./server/resources";
// Tool creation
export { createTool, registerTools } from "./server/tools/create-tool";
// Types
export type {
	McpServer,
	RegisteredTool,
	ToolConfig,
	ToolHandler,
	ToolHandlerContext,
	ToolToolCallback,
	ZodRawShapeCompat,
} from "./server/tools/types";
