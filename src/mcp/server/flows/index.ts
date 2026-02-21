// Flow framework — LangGraph-inspired multi-step flows for MCP tools

export type {
	ConditionFn,
	FlowConfig,
	InterruptSignal,
	NodeConfig,
	NodeHandler,
	RegisteredFlow,
	WidgetSignal,
} from "./@types";
// Types
export { END, interrupt, START, showWidget } from "./@types";
// Convenience factory
export { createFlow } from "./create-flow";
// Builder
export { StateGraph } from "./state-graph";
// Dynamic flows — AI-driven form gathering
export type {
	BooleanField,
	DynamicFlowConfig,
	FieldDefinition,
	NumberField,
	SelectField,
	TextField,
	WidgetField,
} from "./dynamic";
export { createDynamicFlow, field } from "./dynamic";
