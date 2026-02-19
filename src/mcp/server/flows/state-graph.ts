import type {
	ConditionFn,
	Edge,
	FlowConfig,
	NodeConfig,
	NodeHandler,
	RegisteredFlow,
} from "./@types";
import { END, START } from "./@types";
import { compileFlow } from "./compile";

/**
 * A LangGraph-inspired state graph builder for MCP tools.
 *
 * @example
 * ```ts
 * const flow = new StateGraph<MyState>({
 *   id: "onboarding",
 *   title: "User Onboarding",
 *   description: "Guides users through onboarding",
 * })
 *   .addNode("ask_name", () => interrupt({ question: "What's your name?", field: "name" }))
 *   .addNode("greet", (state) => ({ greeting: `Hello ${state.name}!` }))
 *   .addEdge(START, "ask_name")
 *   .addEdge("ask_name", "greet")
 *   .addEdge("greet", END)
 *   .compile();
 * ```
 */
export class StateGraph<TState extends Record<string, unknown>> {
	private nodes = new Map<string, NodeHandler<TState>>();
	private edges = new Map<string, Edge<TState>>();
	private config: FlowConfig;

	constructor(config: FlowConfig) {
		this.config = config;
	}

	/**
	 * Add a node with just a handler.
	 */
	addNode(name: string, handler: NodeHandler<TState>): this;
	/**
	 * Add a node with config (e.g., resource) and a handler.
	 */
	addNode(name: string, config: NodeConfig, handler: NodeHandler<TState>): this;
	addNode(
		name: string,
		configOrHandler: NodeConfig | NodeHandler<TState>,
		maybeHandler?: NodeHandler<TState>,
	): this {
		if (name === START || name === END) {
			throw new Error(
				`"${name}" is a reserved name and cannot be used as a node name`,
			);
		}
		if (this.nodes.has(name)) {
			throw new Error(`Node "${name}" already exists`);
		}

		let handler: NodeHandler<TState>;

		if (typeof configOrHandler === "function") {
			handler = configOrHandler;
		} else {
			if (!maybeHandler) {
				throw new Error(
					`addNode("${name}", config, handler) requires a handler as the third argument`,
				);
			}
			handler = maybeHandler;
		}

		this.nodes.set(name, handler);
		return this;
	}

	/**
	 * Add a direct edge between two nodes.
	 *
	 * Use `START` as `from` to set the entry point.
	 * Use `END` as `to` to mark a terminal node.
	 */
	addEdge(from: string, to: string): this {
		if (this.edges.has(from)) {
			throw new Error(
				`Node "${from}" already has an outgoing edge. Use addConditionalEdge for branching.`,
			);
		}
		this.edges.set(from, { type: "direct", to });
		return this;
	}

	/**
	 * Add a conditional edge from a node.
	 *
	 * The condition function receives current state and returns the name of the next node.
	 */
	addConditionalEdge(from: string, condition: ConditionFn<TState>): this {
		if (this.edges.has(from)) {
			throw new Error(`Node "${from}" already has an outgoing edge.`);
		}
		this.edges.set(from, { type: "conditional", condition });
		return this;
	}

	/**
	 * Compile the graph into a RegisteredFlow that can be registered on an McpServer.
	 *
	 * Validates the graph structure and returns a registration-compatible object.
	 */
	compile(): RegisteredFlow {
		this.validate();

		return compileFlow<TState>({
			config: this.config,
			nodes: new Map(this.nodes),
			edges: new Map(this.edges),
		});
	}

	private validate(): void {
		// Must have a START edge
		if (!this.edges.has(START)) {
			throw new Error(
				'Flow must have an entry point. Add an edge from START: .addEdge(START, "first_node")',
			);
		}

		// START edge target must exist
		const startEdge = this.edges.get(START);
		if (
			startEdge?.type === "direct" &&
			startEdge.to !== END &&
			!this.nodes.has(startEdge.to)
		) {
			throw new Error(
				`START edge references non-existent node: "${startEdge.to}"`,
			);
		}

		// All static edge targets must reference existing nodes (or END)
		for (const [from, edge] of this.edges) {
			if (from !== START && !this.nodes.has(from)) {
				throw new Error(`Edge from non-existent node: "${from}"`);
			}
			if (
				edge.type === "direct" &&
				edge.to !== END &&
				!this.nodes.has(edge.to)
			) {
				throw new Error(
					`Edge from "${from}" references non-existent node: "${edge.to}"`,
				);
			}
		}

		// Every node must have an outgoing edge
		for (const [name] of this.nodes) {
			if (!this.edges.has(name)) {
				throw new Error(
					`Node "${name}" has no outgoing edge. Add one with .addEdge("${name}", ...) or .addConditionalEdge("${name}", ...)`,
				);
			}
		}
	}
}
