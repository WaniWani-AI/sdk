import {
	formatModelContextForPrompt,
	hasModelContext,
	type ModelContextUpdate,
} from "../../shared/model-context";

export function applyModelContextToSystemPrompt(
	systemPrompt: string | undefined,
	modelContext: ModelContextUpdate | undefined,
): string | undefined {
	if (!hasModelContext(modelContext)) {
		return systemPrompt;
	}

	const widgetContext = formatModelContextForPrompt(modelContext);
	if (!widgetContext) {
		return systemPrompt;
	}

	return [systemPrompt, widgetContext].filter(Boolean).join("\n\n");
}
