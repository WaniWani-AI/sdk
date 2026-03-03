import type { RegisteredResource } from "../resources/types";
import type {
	ConditionFn,
	Edge,
	FlowConfig,
	NodeConfig,
	NodeHandler,
	RegisteredFlow,
	WidgetNodeConfig,
} from "./@types";
import { END, START, showWidget } from "./@types";
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
 *   .addNode("ask_name", (state) => interrupt({ question: "What's your name?", field: "name" }))
 *   .addNode("greet", (state) => ({ greeting: `Hello ${state.name}!` }))
 *   .addEdge(START, "ask_name")
 *   .addEdge("ask_name", "greet")
 *   .addEdge("greet", END)
 *   .compile();
 * ```
 */
export class StateGraph<TState extends Record<string, unknown>> {
	private nodes = new Map<string, NodeHandler<TState>>();
	private nodeConfigs = new Map<string, NodeConfig<TState>>();
	private edges = new Map<string, Edge<TState>>();
	private config: FlowConfig;
	private resources: RegisteredResource[] = [];

	constructor(config: FlowConfig) {
		this.config = config;
	}

	/**
	 * Add a node with just a handler.
	 */
	addNode(name: string, handler: NodeHandler<TState>): this;
	/**
	 * Add a node with config and a handler.
	 * Pass `field` to enable auto-skip on widget nodes.
	 */
	addNode(
		name: string,
		config: NodeConfig<TState>,
		handler: NodeHandler<TState>,
	): this;
	/**
	 * Declarative widget node — show a widget without writing a handler.
	 * Resource is declared once; no `showWidget()` call needed.
	 *
	 * @example
	 * ```ts
	 * .addNode("show_pricing", {
	 *   resource: pricingResource,
	 *   field: "selectedPlan",
	 *   description: "Show the pricing tiers.",
	 *   data: (state) => ({ offers: computeOffers(state.idcc) }),
	 * })
	 * ```
	 */
	addNode(name: string, config: WidgetNodeConfig<TState>): this;
	addNode(
		name: string,
		configOrHandler:
			| NodeConfig<TState>
			| NodeHandler<TState>
			| WidgetNodeConfig<TState>,
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
		let nodeConfig: NodeConfig<TState> = {};

		if (typeof configOrHandler === "function") {
			// addNode(name, handler)
			handler = configOrHandler;
		} else if (maybeHandler) {
			// addNode(name, nodeConfig, handler)
			handler = maybeHandler;
			nodeConfig = configOrHandler as NodeConfig<TState>;
		} else {
			// Declarative widget node
			const cfg = configOrHandler as WidgetNodeConfig<TState>;
			this.resources.push(cfg.resource);
			nodeConfig = { field: cfg.field };
			handler = (state) =>
				showWidget(cfg.resource, {
					data:
						typeof cfg.data === "function" ? cfg.data(state) : (cfg.data ?? {}),
					description: cfg.description,
					field: cfg.field,
				});
		}

		this.nodes.set(name, handler);
		this.nodeConfigs.set(name, nodeConfig);
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
			nodeConfigs: new Map(this.nodeConfigs),
			edges: new Map(this.edges),
			resources: [...this.resources],
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
