import type { z } from "zod";
import type { McpServer } from "../resources/types";
import type { RegisteredTool } from "../tools/types";

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
	/** Validation function — runs after the user answers, before advancing to the next node */
	// biome-ignore lint/suspicious/noConfusingVoidType: void is needed so `async () => {}` compiles
	validate?: (value: unknown) => MaybePromise<Record<string, unknown> | void>;
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
	/** The display tool to delegate rendering to */
	tool: RegisteredTool;
	/** Data to pass to the display tool */
	data: Record<string, unknown>;
	/** Description of what the widget does (for the AI's context) */
	description?: string;
	/**
	 * Whether the user is expected to interact with the widget before the flow continues.
	 * Defaults to true. Set to false for informational widgets that should render and then
	 * immediately advance to the next flow step.
	 */
	interactive?: boolean;
	/**
	 * State key this widget fills — enables auto-skip when the field is already in state.
	 * Pass this so the engine can skip the widget step when the answer is already known.
	 */
	field?: string;
};

/**
 * Create an interrupt signal — pauses the flow and asks the user a question.
 * Used internally by the engine. Flow authors use the typed `interrupt` from the node context.
 *
 * Accepts an object where each key is a field name and the value describes the question.
 * The only reserved key is `context` (string) for overall hidden AI instructions.
 */
export function interrupt(
	fields: Record<string, unknown>,
	config?: { context?: string },
): InterruptSignal {
	const context = config?.context;
	const questions: InterruptQuestion[] = [];

	for (const [key, value] of Object.entries(fields)) {
		if (typeof value === "object" && value !== null && "question" in value) {
			const q = value as {
				question: string;
				suggestions?: string[];
				context?: string;
				validate?: (
					value: unknown,
					// biome-ignore lint/suspicious/noConfusingVoidType: void is needed so `async () => {}` compiles
				) => MaybePromise<Record<string, unknown> | void>;
			};
			questions.push({
				question: q.question,
				field: key,
				suggestions: q.suggestions,
				context: q.context,
				validate: q.validate,
			});
		}
	}

	return {
		__type: INTERRUPT,
		questions,
		context,
	};
}

/**
 * Create a widget signal — pauses the flow and delegates rendering to a display tool.
 * Used internally by the engine. Flow authors use the typed `showWidget` from the node context.
 */
export function showWidget(
	tool: RegisteredTool,
	config: {
		data: Record<string, unknown>;
		description?: string;
		interactive?: boolean;
		field?: string;
	},
): WidgetSignal {
	return { __type: WIDGET, tool, ...config };
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
// Node context & handler
// ============================================================================

export type MaybePromise<T> = T | Promise<T>;

/**
 * Typed interrupt function — available on the node context.
 *
 * First argument: an object where each key is a state field name and each value
 * describes the question for that field. `validate` receives the field's value
 * typed from the Zod schema.
 *
 * Second argument (optional): config with overall hidden AI instructions.
 *
 * @example
 * ```ts
 * // Single question
 * interrupt({ breed: { question: "What breed is your pet?" } })
 *
 * // Multiple questions with context
 * interrupt(
 *   {
 *     breed: {
 *       question: "What breed?",
 *       validate: async (breed) => {
 *         const result = await lookupBreed(breed);
 *         if (!result) throw new Error("Unknown breed");
 *         return { breedId: result.id };
 *       },
 *     },
 *     age: { question: "How old is your pet?" },
 *   },
 *   { context: "Ask both questions naturally." },
 * )
 * ```
 */
export type TypedInterrupt<TState> = (
	fields: {
		[F in Extract<keyof TState, string>]?: {
			question: string;
			// biome-ignore lint/suspicious/noConfusingVoidType: void is needed so `async () => {}` compiles
			validate?: (value: TState[F]) => MaybePromise<Partial<TState> | void>;
			suggestions?: string[];
			context?: string;
		};
	},
	config?: {
		/** Overall hidden context/instructions for the assistant (not shown to user directly) */
		context?: string;
	},
) => InterruptSignal;

/**
 * Typed showWidget function — available on the node context.
 * The `field` parameter is typed as `keyof TState`.
 */
export type TypedShowWidget<TState> = (
	tool: RegisteredTool,
	config: {
		data: Record<string, unknown>;
		description?: string;
		interactive?: boolean;
		field?: Extract<keyof TState, string>;
	},
) => WidgetSignal;

/**
 * Context object passed to node handlers.
 * Provides state, metadata, and typed helper functions for creating signals.
 */
export type NodeContext<TState> = {
	/** Current flow state (partial — fields are filled as the flow progresses) */
	state: Partial<TState>;
	/** Request metadata from the MCP call */
	meta?: Record<string, unknown>;
	/** Create an interrupt signal — pause and ask the user questions */
	interrupt: TypedInterrupt<TState>;
	/** Create a widget signal — pause and show a UI widget */
	showWidget: TypedShowWidget<TState>;
};

/**
 * Node handler — receives a context object and returns a signal or state updates.
 * The return value determines behavior:
 * - `Partial<TState>` → action node (state merged, auto-advance)
 * - `InterruptSignal` → interrupt (pause, ask user one or more questions)
 * - `WidgetSignal` → widget step (pause, show widget)
 */
export type NodeHandler<TState> = (
	ctx: NodeContext<TState>,
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
	 * Keys are the field names used in `interrupt({ field })`,
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

export type InterruptQuestionData = {
	question: string;
	field: string;
	suggestions?: string[];
	context?: string;
};

type FlowContentBase = {
	flowToken?: string;
};

export type FlowInterruptContent = FlowContentBase & {
	status: "interrupt";
	/** Single-question shorthand */
	question?: string;
	field?: string;
	suggestions?: string[];
	/** Multi-question */
	questions?: InterruptQuestionData[];
	context?: string;
};

export type FlowWidgetContent = FlowContentBase & {
	status: "widget";
	/** Display tool to call */
	tool: string;
	/** Data to pass to the display tool */
	data: Record<string, unknown>;
	description?: string;
	/** Whether the widget expects user interaction before continuing */
	interactive?: boolean;
};

export type FlowCompleteContent = FlowContentBase & {
	status: "complete";
};

export type FlowErrorContent = FlowContentBase & {
	status: "error";
	error: string;
};

/** Parsed response text from a flow tool call */
export type FlowContent =
	| FlowInterruptContent
	| FlowWidgetContent
	| FlowCompleteContent
	| FlowErrorContent;

export type ExecutionResult = {
	content: FlowContent;
	flowTokenContent?: FlowTokenContent;
};
