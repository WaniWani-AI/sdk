import type {
	AddNodeConfig,
	Edge,
	FlowConfig,
	NodeHandler,
	NodeOptions,
	RegisteredFlow,
} from "./@types";
import { END, START } from "./@types";
import { compileFlow } from "./compile";
import type { FlowStore } from "./flow-store";

function buildMermaidGraph(
	nodes: Map<string, unknown>,
	edges: Map<string, Edge<unknown>>,
): string {
	const lines: string[] = ["flowchart TD"];
	lines.push(`  ${START}((Start))`);
	for (const [name] of nodes) {
		lines.push(`  ${name}[${name}]`);
	}
	lines.push(`  ${END}((End))`);
	for (const [from, edge] of edges) {
		if (edge.type === "direct") {
			lines.push(`  ${from} --> ${edge.to}`);
		} else {
			lines.push(`  ${from} -.-> ${from}_branch([?])`);
		}
	}
	return lines.join("\n");
}

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
 *   .addNode({
 *     id: "ask_name",
 *     run: ({ interrupt }) => interrupt({ question: "What's your name?", field: "name" }),
 *   })
 *   .addNode({
 *     id: "greet",
 *     run: ({ state }) => ({ greeting: `Hello ${state.name}!` }),
 *   })
 *   .addEdge(START, "ask_name")
 *   .addEdge("ask_name", "greet")
 *   .addEdge("greet", END)
 *   .compile();
 * ```
 */
export class StateGraph<
	TState extends Record<string, unknown>,
	TNodes extends string = never,
> {
	private nodes = new Map<string, NodeHandler<TState>>();
	private edges = new Map<string, Edge<TState>>();
	private nodeOptions = new Map<string, NodeOptions>();
	private config: FlowConfig;

	constructor(config: FlowConfig) {
		this.config = config;
	}

	/**
	 * Add a node with a handler.
	 *
	 * The handler receives a context object with `state`, `meta`, `interrupt`, and `showWidget`.
	 *
	 * @example
	 * ```ts
	 * .addNode({
	 *   id: "ask_name",
	 *   label: "Ask for name",
	 *   run: ({ interrupt }) => interrupt({ question: "What's your name?", field: "name" }),
	 * })
	 * ```
	 */
	addNode<TName extends string>(
		config: AddNodeConfig<TState, TName>,
	): StateGraph<TState, TNodes | TName>;
	/**
	 * @deprecated Use the object form: `.addNode({ id, run, label? })`.
	 * The positional form will be removed in v0.13.0
	 */
	addNode<TName extends string>(
		name: TName,
		handler: NodeHandler<TState>,
		options?: NodeOptions,
	): StateGraph<TState, TNodes | TName>;
	addNode<TName extends string>(
		configOrName: TName | AddNodeConfig<TState, TName>,
		handler?: NodeHandler<TState>,
		options?: NodeOptions,
	): StateGraph<TState, TNodes | TName> {
		const id =
			typeof configOrName === "string" ? configOrName : configOrName.id;
		const run =
			typeof configOrName === "string"
				? (handler as NodeHandler<TState>)
				: configOrName.run;
		const label =
			typeof configOrName === "string" ? options?.label : configOrName.label;
		const hideFromFunnel =
			typeof configOrName === "string"
				? options?.hideFromFunnel
				: configOrName.hideFromFunnel;

		if (id === START || id === END) {
			throw new Error(
				`"${id}" is a reserved name and cannot be used as a node name`,
			);
		}
		if (this.nodes.has(id)) {
			throw new Error(`Node "${id}" already exists`);
		}

		this.nodes.set(id, run);
		if (label !== undefined || hideFromFunnel !== undefined) {
			this.nodeOptions.set(id, { label: label ?? id, hideFromFunnel });
		}
		return this as unknown as StateGraph<TState, TNodes | TName>;
	}

	/**
	 * Add a direct edge between two nodes.
	 *
	 * Use `START` as `from` to set the entry point.
	 * Use `END` as `to` to mark a terminal node.
	 */
	addEdge(from: typeof START | TNodes, to: TNodes | typeof END): this {
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
	addConditionalEdge(
		from: TNodes,
		condition: (
			state: Partial<TState>,
		) => TNodes | typeof END | Promise<TNodes | typeof END>,
	): this {
		if (this.edges.has(from)) {
			throw new Error(`Node "${from}" already has an outgoing edge.`);
		}
		this.edges.set(from, { type: "conditional", condition });
		return this;
	}

	/**
	 * Generate a Mermaid `flowchart TD` diagram of the graph.
	 *
	 * Direct edges use solid arrows. Conditional edges use a dashed arrow
	 * to a placeholder since branch targets are determined at runtime.
	 *
	 * @example
	 * ```ts
	 * console.log(graph.graph());
	 * // flowchart TD
	 * //   __start__((Start))
	 * //   ask_name[ask_name]
	 * //   greet[greet]
	 * //   __end__((End))
	 * //   __start__ --> ask_name
	 * //   ask_name --> greet
	 * //   greet --> __end__
	 * ```
	 */
	graph(): string {
		return buildMermaidGraph(this.nodes, this.edges);
	}

	/**
	 * Compile the graph into a RegisteredFlow that can be registered on an McpServer.
	 *
	 * Validates the graph structure and returns a registration-compatible object.
	 */
	compile(options?: { store?: FlowStore }): RegisteredFlow {
		this.validate();

		const nodesCopy = new Map(this.nodes);
		const edgesCopy = new Map(this.edges);

		return compileFlow<TState>({
			config: this.config,
			nodes: nodesCopy,
			edges: edgesCopy,
			store: options?.store,
			graph: () => buildMermaidGraph(nodesCopy, edgesCopy),
			nodeOptions: new Map(this.nodeOptions),
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
