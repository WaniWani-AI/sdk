// Metadata Extraction Module

import type {
	LocationInfo,
	MCPProvider,
	NormalizedMeta,
	OpenAIMeta,
} from "./@types.js";

/**
 * Detect which MCP provider sent the request based on metadata keys
 */
export function detectProvider(meta: Record<string, unknown>): MCPProvider {
	if (meta["openai/subject"] || meta["openai/session"]) {
		return "openai";
	}
	// Add Anthropic detection when their MCP format is known
	// if (meta['anthropic/...']) return 'anthropic';
	return "unknown";
}

/**
 * Extract normalized metadata from any MCP provider's metadata
 */
export function extractMetadata(meta: Record<string, unknown>): NormalizedMeta {
	const provider = detectProvider(meta);

	switch (provider) {
		case "openai":
			return extractOpenAIMeta(meta as unknown as OpenAIMeta);
		case "anthropic":
			return extractAnthropicMeta(meta);
		default:
			return { provider: "unknown" };
	}
}

function extractOpenAIMeta(meta: OpenAIMeta): NormalizedMeta {
	const rawLocation = meta["openai/userLocation"];
	let location: LocationInfo | undefined;

	if (rawLocation) {
		location = {
			city: rawLocation.city,
			region: rawLocation.region,
			country: rawLocation.country,
			timezone: rawLocation.timezone,
		};
	}

	return {
		provider: "openai",
		sessionId: meta["openai/session"],
		externalUserId: meta["openai/subject"],
		userAgent: meta["openai/userAgent"],
		locale: meta["openai/locale"],
		location,
	};
}

function extractAnthropicMeta(_meta: Record<string, unknown>): NormalizedMeta {
	// Placeholder for Anthropic extraction logic
	// Will be implemented when Anthropic MCP metadata format is known
	return { provider: "anthropic" };
}
