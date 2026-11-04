import type {
	Edge,
	FlowConfig,
	FlowGraph,
	FlowGraphEdge,
	FlowGraphNode,
	NodeHandler,
	NodeOptions,
} from "./@types";

function classifyNode<TState extends Record<string, unknown>>(
	handler: NodeHandler<TState>,
): "widget" | "interrupt" | "action" {
	const src = handler.toString();
	if (src.includes("showWidget")) {
		return "widget";
	}
	if (src.includes("interrupt")) {
		return "interrupt";
	}
	return "action";
}

export function extractFlowGraph<TState extends Record<string, unknown>>(
	config: FlowConfig,
	nodes: Map<string, NodeHandler<TState>>,
	edges: Map<string, Edge<TState>>,
	nodeOptions: Map<string, NodeOptions>,
): FlowGraph {
	const graphNodes: FlowGraphNode[] = [];
	for (const [id, handler] of nodes) {
		const opts = nodeOptions.get(id);
		graphNodes.push({
			id,
			type: classifyNode(handler),
			label: opts?.label ?? id,
			...(opts?.hideFromFunnel ? { hideFromFunnel: true } : {}),
		});
	}

	const graphEdges: FlowGraphEdge[] = [];
	for (const [from, edge] of edges) {
		if (edge.type === "direct") {
			graphEdges.push({ from, to: edge.to, type: "direct" });
		} else {
			graphEdges.push({ from, to: edge.targets, type: "conditional" });
		}
	}

	return {
		flowId: config.id,
		title: config.title,
		nodes: graphNodes,
		edges: graphEdges,
	};
}
