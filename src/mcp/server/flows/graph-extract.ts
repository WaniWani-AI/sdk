import type {
	Edge,
	FlowConfig,
	FlowGraph,
	FlowGraphEdge,
	FlowGraphNode,
	NodeHandler,
	NodeOptions,
} from "./@types";
import { END } from "./@types";

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

function extractConditionalTargets(
	condition: (...args: unknown[]) => unknown,
	knownIds: Set<string>,
): string[] {
	const src = condition.toString();
	const targets: string[] = [];
	for (const id of knownIds) {
		const doubleQuoted = `"${id}"`;
		const singleQuoted = `'${id}'`;
		const backtickQuoted = `\`${id}\``;
		if (
			src.includes(doubleQuoted) ||
			src.includes(singleQuoted) ||
			src.includes(backtickQuoted)
		) {
			targets.push(id);
		}
	}
	return targets;
}

export function extractFlowGraph<TState extends Record<string, unknown>>(
	config: FlowConfig,
	nodes: Map<string, NodeHandler<TState>>,
	edges: Map<string, Edge<TState>>,
	nodeOptions: Map<string, NodeOptions>,
): FlowGraph {
	const knownIds = new Set([...nodes.keys(), END]);

	const graphNodes: FlowGraphNode[] = [];
	for (const [id, handler] of nodes) {
		const opts = nodeOptions.get(id);
		graphNodes.push({
			id,
			type: classifyNode(handler),
			trackFunnel: opts?.trackFunnel ?? false,
		});
	}

	const graphEdges: FlowGraphEdge[] = [];
	for (const [from, edge] of edges) {
		if (edge.type === "direct") {
			graphEdges.push({ from, to: edge.to, type: "direct" });
		} else {
			const targets = extractConditionalTargets(
				edge.condition as (state: unknown) => unknown,
				knownIds,
			);
			graphEdges.push({ from, to: targets, type: "conditional" });
		}
	}

	return {
		flowId: config.id,
		title: config.title,
		nodes: graphNodes,
		edges: graphEdges,
	};
}
