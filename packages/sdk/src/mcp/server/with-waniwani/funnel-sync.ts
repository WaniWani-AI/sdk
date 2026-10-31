import type { FlowGraph } from "../flows/@types";

async function hashData(data: string): Promise<string> {
	if (typeof globalThis.crypto?.subtle?.digest === "function") {
		const buf = await crypto.subtle.digest(
			"SHA-256",
			new TextEncoder().encode(data),
		);
		return Array.from(new Uint8Array(buf))
			.map((b) => b.toString(16).padStart(2, "0"))
			.join("");
	}
	let hash = 0;
	for (let i = 0; i < data.length; i++) {
		hash = ((hash << 5) - hash + data.charCodeAt(i)) | 0;
	}
	return `simple-${Math.abs(hash).toString(36)}`;
}

function hashGraph(graph: FlowGraph): Promise<string> {
	return hashData(JSON.stringify({ nodes: graph.nodes, edges: graph.edges }));
}

export type FunnelSyncFlow = {
	flowId: string;
	title: string;
	configHash: string;
	nodes: FlowGraph["nodes"];
	edges: FlowGraph["edges"];
};

export type FunnelSyncPayload = {
	compositeHash: string;
	flows: FunnelSyncFlow[];
};

export async function prepareFunnelSyncPayload(
	flowGraphs: FlowGraph[],
): Promise<FunnelSyncPayload | null> {
	if (flowGraphs.length === 0) {
		return null;
	}

	const sorted = [...flowGraphs].sort((a, b) =>
		a.flowId.localeCompare(b.flowId),
	);

	const compositeHash = await hashData(
		JSON.stringify(
			sorted.map((fg) => ({
				flowId: fg.flowId,
				nodes: fg.nodes,
				edges: fg.edges,
			})),
		),
	);

	const flows = await Promise.all(
		flowGraphs.map(async (fg) => ({
			flowId: fg.flowId,
			title: fg.title,
			configHash: await hashGraph(fg),
			nodes: fg.nodes,
			edges: fg.edges,
		})),
	);

	return { compositeHash, flows };
}
