import type { ZodRawShapeCompat } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type {
	CallToolResult,
	ServerNotification,
	ServerRequest,
} from "@modelcontextprotocol/sdk/types.js";
import type { z } from "zod";
import type { McpServer } from "../resources/types";
import type { ScopedWaniWaniClient } from "../scoped-client";
import type { RegisteredTool } from "../tools/types";
import type { FlowStore } from "./flow-store";

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
	/** The id of the display tool to delegate rendering to */
	tool: string;
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
	tool: RegisteredTool | string,
	config: {
		data: Record<string, unknown>;
		description?: string;
		interactive?: boolean;
		field?: string;
	},
): WidgetSignal {
	return {
		__type: WIDGET,
		tool: typeof tool === "string" ? tool : tool.id,
		...config,
	};
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

// ============================================================================
// Nested state utility types
// ============================================================================

/** Deep partial — allows partial updates at any nesting level (for z.object state fields). */
export type DeepPartial<T> = {
	[K in keyof T]?: T[K] extends Record<string, unknown>
		? DeepPartial<T[K]>
		: T[K];
};

/**
 * Extract known (non-index-signature) string keys from a type.
 * Zod v4's z.object() adds `[key: string]: unknown` to inferred types,
 * so we filter those out to get only the declared field names.
 */
type KnownStringKeys<T> = Extract<
	keyof {
		[K in keyof T as string extends K
			? never
			: number extends K
				? never
				: K]: T[K];
	},
	string
>;

/**
 * Union of all valid field paths for a state type.
 * - Flat fields produce their key: `"email"`
 * - `z.object()` fields produce dot-paths to sub-fields: `"driver.name"`, `"driver.license"`
 * - Arrays and general records (`z.record()`) are treated as flat fields.
 * - Only 1 level of nesting is supported.
 */
export type FieldPaths<TState> = {
	[K in Extract<keyof TState, string>]: NonNullable<TState[K]> extends unknown[]
		? K
		: NonNullable<TState[K]> extends Record<string, unknown>
			? KnownStringKeys<NonNullable<TState[K]>> extends never
				? K
				: K | `${K}.${KnownStringKeys<NonNullable<TState[K]>>}`
			: K;
}[Extract<keyof TState, string>];

/** Resolve a dot-path to the value type at that path in TState. */
export type ResolveFieldType<
	TState,
	P extends string,
> = P extends `${infer Parent}.${infer Child}`
	? Parent extends keyof TState
		? Child extends keyof NonNullable<TState[Parent]>
			? NonNullable<TState[Parent]>[Child]
			: never
		: never
	: P extends keyof TState
		? TState[P]
		: never;

// ============================================================================
// Typed interrupt & showWidget
// ============================================================================

/**
 * Typed interrupt function — available on the node context.
 *
 * First argument: an object where each key is a field path and each value
 * describes the question for that field. Use dot-paths for nested state fields.
 * `validate` receives the field's value typed from the Zod schema.
 *
 * Second argument (optional): config with overall hidden AI instructions.
 *
 * @example
 * ```ts
 * // Flat field
 * interrupt({ breed: { question: "What breed is your pet?" } })
 *
 * // Nested field (z.object in state)
 * interrupt({ "driver.name": { question: "Driver's name?" } })
 *
 * // Multiple questions with context
 * interrupt(
 *   {
 *     "driver.name": { question: "Name?" },
 *     "driver.license": { question: "License?" },
 *   },
 *   { context: "Ask both questions naturally." },
 * )
 * ```
 */
export type TypedInterrupt<TState> = (
	fields: {
		[P in FieldPaths<TState>]?: {
			question: string;
			validate?: (
				value: ResolveFieldType<TState, P>,
				// biome-ignore lint/suspicious/noConfusingVoidType: void is needed so `async () => {}` compiles
			) => MaybePromise<DeepPartial<TState> | void>;
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
 * The `field` parameter accepts field paths (flat or dot-path for nested state).
 */
export type TypedShowWidget<TState> = (
	tool: RegisteredTool | string,
	config: {
		data: Record<string, unknown>;
		description?: string;
		interactive?: boolean;
		field?: FieldPaths<TState>;
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
	/** Session-scoped WaniWani client — available when the server is wrapped with withWaniwani() */
	waniwani?: ScopedWaniWaniClient;
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
) => MaybePromise<DeepPartial<TState> | InterruptSignal | WidgetSignal>;

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

export type NodeOptions = {
	trackFunnel?: true | string;
};

export type FlowGraphNode = {
	id: string;
	type: "widget" | "interrupt" | "action";
	trackFunnel: false | true | string;
};

export type FlowGraphEdge =
	| { from: string; to: string; type: "direct" }
	| { from: string; to: string[]; type: "conditional" };

export type FlowGraph = {
	flowId: string;
	title: string;
	nodes: FlowGraphNode[];
	edges: FlowGraphEdge[];
};

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
 * Flow tool handler — uses shared MCP types (`RequestHandlerExtra`, `CallToolResult`)
 * so it's assignable to both MCP SDK's `ToolCallback` and Skybridge's `ToolHandler`.
 */
export type FlowToolHandler = (
	args: Record<string, unknown>,
	extra: RequestHandlerExtra<ServerRequest, ServerNotification>,
) => CallToolResult | Promise<CallToolResult>;

/**
 * A compiled flow — can be registered on an McpServer.
 *
 * Exposes MCP-compatible `name`, `config`, and `handler` so it can be
 * registered directly: `server.registerTool(flow.name, flow.config, flow.handler)`
 */
export type RegisteredFlow = {
	/** Tool name — pass to `server.registerTool(flow.name, flow.config, flow.handler)`. */
	name: string;
	/** Tool config object — pass to `server.registerTool(flow.name, flow.config, flow.handler)`. */
	config: {
		title: string;
		description: string;
		inputSchema: ZodRawShapeCompat;
		annotations?: {
			readOnlyHint?: boolean;
			idempotentHint?: boolean;
			openWorldHint?: boolean;
			destructiveHint?: boolean;
		};
	};
	/** Tool callback — pass to `server.registerTool(flow.name, flow.config, flow.handler)`. */
	handler: FlowToolHandler;
	/** Register this flow on an MCP server. Shorthand for `server.registerTool(flow.name, flow.config, flow.handler)`. */
	register: (server: McpServer) => Promise<void>;
	/** Returns a Mermaid `flowchart TD` diagram of the flow graph. */
	graph: () => string;
	flowGraph: FlowGraph;
};

export interface CompileInput<TState extends Record<string, unknown>> {
	config: FlowConfig;
	nodes: Map<string, NodeHandler<TState>>;
	edges: Map<string, Edge<TState>>;
	store?: FlowStore;
	graph: () => string;
	nodeOptions: Map<string, NodeOptions>;
}

export type FlowToolInput = {
	action: "start" | "continue";
	/** Required when `action` is `"start"`. */
	intent?: string;
	stateUpdates?: Record<string, unknown>;
};

export type FlowTokenContent = {
	step?: string;
	state: Record<string, unknown>;
	field?: string;
	widgetId?: string;
};

export type InterruptQuestionData = {
	question: string;
	field: string;
	suggestions?: string[];
	context?: string;
};

export type FlowInterruptContent = {
	status: "interrupt";
	/** Single-question shorthand */
	question?: string;
	field?: string;
	suggestions?: string[];
	/** Multi-question */
	questions?: InterruptQuestionData[];
	context?: string;
};

export type FlowWidgetContent = {
	status: "widget";
	/** Display tool to call */
	tool: string;
	/** Data to pass to the display tool */
	data: Record<string, unknown>;
	description?: string;
	/** Whether the widget expects user interaction before continuing */
	interactive?: boolean;
};

export type FlowCompleteContent = {
	status: "complete";
};

export type FlowErrorContent = {
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
