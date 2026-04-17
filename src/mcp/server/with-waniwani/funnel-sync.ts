import type { FlowGraph } from "../flows/@types";

async function hashGraph(graph: FlowGraph): Promise<string> {
	const data = JSON.stringify({ nodes: graph.nodes, edges: graph.edges });
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

export async function syncFlowGraphs(
	flowGraphs: FlowGraph[],
	apiUrl: string,
	apiKey: string,
): Promise<void> {
	if (flowGraphs.length === 0) {
		return;
	}

	const flows = await Promise.all(
		flowGraphs.map(async (fg) => ({
			...fg,
			configHash: await hashGraph(fg),
		})),
	);

	const payload = JSON.stringify({ flows });

	try {
		const url = `${apiUrl}/api/mcp/funnel/sync`;
		fetch(url, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${apiKey}`,
			},
			body: payload,
		}).catch(() => {});
	} catch {}
}
