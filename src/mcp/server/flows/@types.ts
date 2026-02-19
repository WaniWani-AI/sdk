import type { McpServer, RegisteredResource } from "../resources/types";

export type { McpServer };

// ============================================================================
// Sentinel constants
// ============================================================================

export const START = "__start__" as const;
export const END = "__end__" as const;

// ============================================================================
// Signal types — returned by node handlers to control flow behavior
// ============================================================================

const INTERRUPT = Symbol.for("waniwani.flow.interrupt");
const WIDGET = Symbol.for("waniwani.flow.widget");

export type InterruptSignal = {
	readonly __type: typeof INTERRUPT;
	/** Question to ask the user */
	question: string;
	/** State key where the answer will be stored */
	field: string;
	/** Optional suggestions to present as options */
	suggestions?: string[];
	/** Hidden context/instructions for the assistant (not shown to user directly) */
	context?: string;
};

export type WidgetSignal = {
	readonly __type: typeof WIDGET;
	/** The resource to display */
	resource: RegisteredResource;
	/** Data to pass to the widget as structuredContent */
	data: Record<string, unknown>;
	/** Description of what the widget does (for the AI's context) */
	description?: string;
};

/**
 * Create an interrupt signal — pauses the flow and asks the user a text question.
 */
export function interrupt(config: {
	question: string;
	field: string;
	suggestions?: string[];
	context?: string;
}): InterruptSignal {
	return { __type: INTERRUPT, ...config };
}

/**
 * Create a widget signal — pauses the flow and renders a widget UI.
 */
export function showWidget(
	resource: RegisteredResource,
	config: {
		data: Record<string, unknown>;
		description?: string;
	},
): WidgetSignal {
	return { __type: WIDGET, resource, ...config };
}

export function isInterrupt(value: unknown): value is InterruptSignal {
	return (
		typeof value === "object" &&
		value !== null &&
		"__type" in value &&
		(value as InterruptSignal).__type === INTERRUPT
	);
}

export function isWidget(value: unknown): value is WidgetSignal {
	return (
		typeof value === "object" &&
		value !== null &&
		"__type" in value &&
		(value as WidgetSignal).__type === WIDGET
	);
}

// ============================================================================
// Node & edge definitions
// ============================================================================

export type MaybePromise<T> = T | Promise<T>;

/** Configuration for a flow node */
export type NodeConfig = {
	/** Resource to display when this node returns a WidgetSignal */
	resource?: RegisteredResource;
};

/**
 * Node handler — a single function type for all node kinds.
 * The return value determines behavior:
 * - `Partial<TState>` → action node (state merged, auto-advance)
 * - `InterruptSignal` → interrupt (pause, ask user)
 * - `WidgetSignal` → widget step (pause, show widget)
 */
export type NodeHandler<TState> = (
	state: Partial<TState>,
	meta?: Record<string, unknown>,
) => MaybePromise<Partial<TState> | InterruptSignal | WidgetSignal>;

/**
 * Condition function for conditional edges.
 * Receives current state, returns the name of the next node.
 */
export type ConditionFn<TState> = (
	state: Partial<TState>,
) => string | Promise<string>;

export type Edge<TState> =
	| { type: "direct"; to: string }
	| { type: "conditional"; condition: ConditionFn<TState> };

// ============================================================================
// Flow config & compiled output
// ============================================================================

export type FlowConfig = {
	/** Unique identifier for the flow (becomes the MCP tool name) */
	id: string;
	/** Display title */
	title: string;
	/** Description for the AI (explains when to use this flow) */
	description: string;
	/** Optional tool annotations */
	annotations?: {
		readOnlyHint?: boolean;
		idempotentHint?: boolean;
		openWorldHint?: boolean;
		destructiveHint?: boolean;
	};
};

/**
 * A compiled flow — can be registered on an McpServer.
 */
export type RegisteredFlow = {
	id: string;
	title: string;
	description: string;
	register: (server: McpServer) => Promise<void>;
};
