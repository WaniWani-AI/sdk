import type { RegisteredResource } from "../../resources/types";
import type { MaybePromise, WidgetSignal } from "../@types";

// ============================================================================
// Field types
// ============================================================================

type BaseFieldConfig = {
	/** Human-readable label for this field */
	label: string;
	/** Longer description providing context for the AI */
	description?: string;
	/** Whether this field must be gathered (default: true) */
	required?: boolean;
	/** AI instruction for how to gather this field — tone, approach, follow-ups */
	hint?: string;
	/** Fields that must be gathered before this one becomes active */
	dependsOn?: string[];
	/** Condition function — field is only active when this returns true */
	when?: (state: Record<string, unknown>) => boolean;
};

export type TextField = BaseFieldConfig & {
	type: "text";
	/** Validation function — return true if valid, or an error message string */
	validate?: (value: string) => MaybePromise<true | string>;
};

export type SelectField = BaseFieldConfig & {
	type: "select";
	/** Available options for the user to choose from */
	options: string[] | { label: string; value: string }[];
};

export type NumberField = BaseFieldConfig & {
	type: "number";
	min?: number;
	max?: number;
};

export type BooleanField = BaseFieldConfig & {
	type: "boolean";
};

export type WidgetField = BaseFieldConfig & {
	type: "widget";
	/** Resource to display for this field */
	resource: RegisteredResource;
	/** Static data to pass to the widget */
	data?: Record<string, unknown>;
};

export type FieldDefinition =
	| TextField
	| SelectField
	| NumberField
	| BooleanField
	| WidgetField;

// ============================================================================
// Dynamic flow config
// ============================================================================

export type DynamicFlowConfig<TState extends Record<string, unknown>> = {
	/** Unique identifier for the flow (becomes the MCP tool name) */
	id: string;
	/** Display title */
	title: string;
	/** Description for the AI (explains when to use this flow) */
	description: string;
	/** Field definitions — what data to gather */
	fields: { [K in keyof TState]: FieldDefinition };
	/** Handler called when all required fields are gathered and valid */
	onComplete: (
		state: TState,
		meta?: Record<string, unknown>,
	) => MaybePromise<Record<string, unknown> | WidgetSignal>;
	/** Optional tool annotations */
	annotations?: {
		readOnlyHint?: boolean;
		idempotentHint?: boolean;
		openWorldHint?: boolean;
		destructiveHint?: boolean;
	};
};

// ============================================================================
// Tool input/output types
// ============================================================================

export type DynamicFlowToolInput = {
	action: "start" | "submit" | "widget_result";
	data?: Record<string, unknown>;
	step?: string;
	state?: Record<string, unknown>;
	widgetResult?: Record<string, unknown>;
};

/** Serialized field schema sent to the AI — functions stripped */
export type SerializedField = {
	type: "text" | "select" | "number" | "boolean" | "widget";
	label: string;
	description?: string;
	required: boolean;
	hint?: string;
	dependsOn?: string[];
	options?: string[] | { label: string; value: string }[];
	min?: number;
	max?: number;
};
