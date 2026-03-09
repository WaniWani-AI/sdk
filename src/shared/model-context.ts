import type { ContentBlock } from "@modelcontextprotocol/sdk/types.js";

export type ModelContextContentBlock = ContentBlock;

export type ModelContextUpdate = {
	content?: ModelContextContentBlock[];
	structuredContent?: Record<string, unknown>;
};

export function hasModelContext(
	value: ModelContextUpdate | null | undefined,
): value is ModelContextUpdate {
	if (!value) return false;
	const hasContent = Array.isArray(value.content) && value.content.length > 0;
	const hasStructuredContent =
		typeof value.structuredContent === "object" &&
		value.structuredContent !== null &&
		Object.keys(value.structuredContent).length > 0;
	return hasContent || hasStructuredContent;
}

export function mergeModelContext(
	current: ModelContextUpdate | null | undefined,
	next: ModelContextUpdate | null | undefined,
): ModelContextUpdate | null {
	if (!hasModelContext(current) && !hasModelContext(next)) return null;
	if (!hasModelContext(current)) {
		return {
			...(next?.content ? { content: [...next.content] } : {}),
			...(next?.structuredContent
				? { structuredContent: { ...next.structuredContent } }
				: {}),
		};
	}
	if (!hasModelContext(next)) {
		return {
			...(current.content ? { content: [...current.content] } : {}),
			...(current.structuredContent
				? { structuredContent: { ...current.structuredContent } }
				: {}),
		};
	}

	return {
		...(current.content || next.content
			? { content: [...(current.content ?? []), ...(next.content ?? [])] }
			: {}),
		...(current.structuredContent || next.structuredContent
			? {
					structuredContent: {
						...(current.structuredContent ?? {}),
						...(next.structuredContent ?? {}),
					},
				}
			: {}),
	};
}

export function formatModelContextForPrompt(
	value: ModelContextUpdate | null | undefined,
): string {
	if (!hasModelContext(value)) return "";

	const sections: string[] = [
		"## Widget Model Context",
		"This hidden context was supplied by an MCP App via `ui/update-model-context`.",
		"Use it for the next assistant turn only. If it includes flow continuation or tool-call instructions, follow them exactly.",
	];

	if (value.content?.length) {
		const renderedBlocks = value.content
			.map((block) => {
				if (block.type === "text" && typeof block.text === "string") {
					return block.text.trim();
				}
				return JSON.stringify(block, null, 2);
			})
			.filter(Boolean)
			.join("\n\n");
		if (renderedBlocks) {
			sections.push(`Content blocks:\n${renderedBlocks}`);
		}
	}

	if (
		value.structuredContent &&
		Object.keys(value.structuredContent).length > 0
	) {
		sections.push(
			`Structured content JSON:\n${JSON.stringify(value.structuredContent, null, 2)}`,
		);
	}

	return sections.join("\n\n");
}
