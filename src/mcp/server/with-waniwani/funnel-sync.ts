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

// ---------------------------------------------------------------------------
// globalThis-based cache so the sync HTTP call is made at most once per
// cold start per Lambda/serverless instance. Same pattern as project-config.ts.
// ---------------------------------------------------------------------------

const SYNC_CACHE_KEY = "__waniwani_funnel_sync_cache__" as const;

function getSyncCache(): Map<string, string> {
	const g = globalThis as Record<string, unknown>;
	if (!g[SYNC_CACHE_KEY]) {
		g[SYNC_CACHE_KEY] = new Map<string, string>();
	}
	return g[SYNC_CACHE_KEY] as Map<string, string>;
}

export async function syncFlowGraphs(
	flowGraphs: FlowGraph[],
	apiUrl: string,
	apiKey: string,
): Promise<void> {
	if (flowGraphs.length === 0) {
		return;
	}

	// Composite hash of all graphs sorted by flowId for determinism.
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

	const cache = getSyncCache();
	if (cache.get(apiKey) === compositeHash) {
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
		})
			.then(() => {
				cache.set(apiKey, compositeHash);
			})
			.catch(() => {});
	} catch {}
}
