import type { z } from "zod";
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

/** A single question within an interrupt step */
export type InterruptQuestion = {
	/** Question to ask the user */
	question: string;
	/** State key where the answer will be stored */
	field: string;
	/** Optional suggestions to present as options */
	suggestions?: string[];
	/** Hidden context/instructions for this specific question (not shown to user directly) */
	context?: string;
};

/**
 * Interrupt signal — pauses the flow and asks the user one or more questions.
 * Single-question and multi-question interrupts use the same type.
 */
export type InterruptSignal = {
	readonly __type: typeof INTERRUPT;
	/** Questions to ask — ask all in one conversational message */
	questions: InterruptQuestion[];
	/** Overall hidden context/instructions for the assistant (not shown to user directly) */
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
	/**
	 * State key this widget fills — enables auto-skip when the field is already in state.
	 * Pass this so the engine can skip the widget step when the answer is already known.
	 */
	field?: string;
};

/**
 * Create an interrupt signal — pauses the flow and asks the user a question.
 *
 * Accepts a single question (shorthand) or multiple questions (array form).
 * Both produce the same signal type.
 *
 * @example Single question
 * ```ts
 * return interrupt({ question: "Your email?", field: "email" })
 * ```
 *
 * @example Multiple questions (asked together in one message)
 * ```ts
 * return interrupt({ questions: [
 *   { question: "How many employees?", field: "headcount" },
 *   { question: "Average age?", field: "averageAge" },
 * ]})
 * ```
 */
export function interrupt(
	config:
		| {
				question: string;
				field: string;
				suggestions?: string[];
				context?: string;
		  }
		| { questions: InterruptQuestion[]; context?: string },
): InterruptSignal {
	if ("questions" in config) {
		return {
			__type: INTERRUPT,
			questions: config.questions,
			context: config.context,
		};
	}
	const { question, field, context, suggestions } = config;
	return {
		__type: INTERRUPT,
		questions: [{ question, field, context, suggestions }],
	};
}

/**
 * Create a widget signal — pauses the flow and renders a widget UI.
 *
 * Pass `field` to enable auto-skip: if the field is already in state, the widget
 * step will be skipped automatically.
 */
export function showWidget(
	resource: RegisteredResource,
	config: {
		data: Record<string, unknown>;
		description?: string;
		field?: string;
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

/**
 * Optional config for handler-based nodes.
 * Provides metadata used by the engine (e.g., auto-skip on widget steps).
 *
 * For declarative nodes, config is inferred automatically — no need to pass this.
 */
export type NodeConfig<
	TState extends Record<string, unknown> = Record<string, unknown>,
> = {
	/**
	 * State key this node fills.
	 * When set on a handler-based widget node and the field is already in state,
	 * the node is auto-skipped. (Alternatively, pass `field` to `showWidget()`.)
	 */
	field?: Extract<keyof TState, string>;
	/**
	 * Mark this node as conversational — the AI will engage in back-and-forth
	 * conversation before advancing to the next node.
	 *
	 * - `true` — generic conversational behavior
	 * - `string` — specific guidance for the AI (e.g., "Help the user compare plans")
	 */
	conversational?: boolean | string;
};

// ============================================================================
// Declarative node configs — shorthand for common patterns, no handler needed
// ============================================================================

/**
 * Node handler — a single function type for all node kinds.
 * The return value determines behavior:
 * - `Partial<TState>` → action node (state merged, auto-advance)
 * - `InterruptSignal` → interrupt (pause, ask user one or more questions)
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
	/**
	 * Define the flow's state — each field the flow collects.
	 * Keys are the field names used in `interrupt({ field })` or `NodeConfig.field`,
	 * values are Zod schemas with `.describe()`.
	 *
	 * The state definition serves two purposes:
	 * 1. Type inference — `TState` is automatically derived, no explicit generic needed
	 * 2. AI protocol — field names, types, and descriptions are included in the tool
	 *    description so the AI can pre-fill answers via `_meta.flow.state`
	 *
	 * @example
	 * ```ts
	 * state: {
	 *   country: z.string().describe("Country the business is based in"),
	 *   status: z.enum(["registered", "unregistered"]).describe("Business registration status"),
	 * }
	 * ```
	 */
	state: Record<string, z.ZodType>;
	/**
	 * Container resource — when set, ALL widget steps use this single resource
	 * as the output template, and `__widgetId` is injected into `structuredContent`
	 * so the container can route to the correct sub-widget.
	 */
	resource?: RegisteredResource;
	/** Optional tool annotations */
	annotations?: {
		readOnlyHint?: boolean;
		idempotentHint?: boolean;
		openWorldHint?: boolean;
		destructiveHint?: boolean;
	};
};

/**
 * Infer the runtime state type from a flow's state schema definition.
 *
 * @example
 * ```ts
 * const config = {
 *   state: {
 *     country: z.enum(["FR", "DE"]),
 *     status: z.enum(["registered", "unregistered"]),
 *   }
 * };
 * type MyState = InferFlowState<typeof config.state>;
 * // { country: "FR" | "DE"; status: "registered" | "unregistered" }
 * ```
 */
export type InferFlowState<T extends Record<string, z.ZodType>> = {
	[K in keyof T]: z.infer<T[K]>;
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

export interface CompileInput<TState extends Record<string, unknown>> {
	config: FlowConfig;
	nodes: Map<string, NodeHandler<TState>>;
	nodeConfigs: Map<string, NodeConfig<TState>>;
	edges: Map<string, Edge<TState>>;
}

export type FlowToolInput = {
	action: "start" | "continue";
	stateUpdates?: Record<string, unknown>;
	flowToken?: string;
};

export type FlowTokenContent = {
	step?: string;
	state: Record<string, unknown>;
	field?: string;
	widgetId?: string;
	/** Cached interrupt questions — avoids re-executing the handler on partial answers */
	questions?: Array<{
		question: string;
		field: string;
		suggestions?: string[];
		context?: string;
	}>;
	/** Cached overall interrupt context */
	interruptContext?: string;
};

/** Parsed response text from a flow tool call */
export type FlowContent = {
	status: "widget" | "interrupt" | "complete" | "error";
	description?: string;
	question?: string;
	error?: string;
	flowToken?: string;
};

export type ExecutionResult = {
	content: FlowContent;
	structuredContent?: Record<string, unknown>;
	_meta?: Record<string, unknown>;
	flowTokenContent?: FlowTokenContent;
};
