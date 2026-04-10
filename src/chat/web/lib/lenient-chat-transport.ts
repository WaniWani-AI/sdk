/**
 * A forward-compatible chat transport that handles version mismatches between
 * the server's `ai` package and the client's `ai` package.
 *
 * Two layers of protection:
 * 1. When a chunk fails validation due to unrecognized fields (from a newer
 *    `ai` version using `strictObject`), extracts exactly which fields are
 *    rejected, strips only those, and retries. This preserves events like
 *    tool outputs so widgets keep rendering.
 * 2. If the chunk is a completely unknown event type, silently skips it.
 *    The chat keeps working; only the unrecognised visual is missing.
 */
import { DefaultChatTransport, uiMessageChunkSchema } from "ai";
import type { UIMessage, UIMessageChunk } from "ai";

/**
 * Extracts unrecognized field names from a validation error.
 *
 * Ideally we'd use Zod's `.strip()` to silently drop unknown keys, but
 * `uiMessageChunkSchema()` wraps the Zod union in a `zodSchema()` closure
 * that only exposes a `.validate` method — the raw Zod schema is unreachable,
 * so we can't call `.strip()` on each union branch. Duplicating the schema
 * here would be fragile and defeat the forward-compatibility goal.
 *
 * Instead we parse the Zod error: when a `strictObject` union branch matches
 * on `type` but rejects unknown fields, the error contains `invalid_union`
 * with per-branch errors. We find the branch that matched on `type` (no
 * `invalid_value` on the `type` path) and return its `unrecognized_keys`.
 */
function extractKeysToStrip(error: unknown): string[] | null {
	const cause = (error as { cause?: unknown })?.cause;
	// biome-ignore lint/suspicious/noExplicitAny: Zod error internals vary across versions
	const issues: any[] | undefined =
		(cause as { issues?: unknown[] })?.issues ??
		(cause as { errors?: unknown[] })?.errors;
	if (!Array.isArray(issues)) return null;

	// biome-ignore lint/suspicious/noExplicitAny: navigating untyped Zod error tree
	const unionIssue = issues.find((i: any) => i.code === "invalid_union");
	if (!unionIssue?.errors) return null;

	for (const branchErrors of unionIssue.errors) {
		if (!Array.isArray(branchErrors)) continue;

		// Skip branches where `type` didn't match — they have invalid_value on path ["type"]
		const hasTypeMismatch = branchErrors.some(
			// biome-ignore lint/suspicious/noExplicitAny: untyped error
			(e: any) =>
				(e.code === "invalid_value" || e.code === "invalid_literal") &&
				e.path?.[0] === "type",
		);
		if (hasTypeMismatch) continue;

		// This branch matched on type — extract its unrecognized keys
		const unrecognized = branchErrors
			// biome-ignore lint/suspicious/noExplicitAny: untyped error
			.filter((e: any) => e.code === "unrecognized_keys")
			// biome-ignore lint/suspicious/noExplicitAny: untyped error
			.flatMap((e: any) => e.keys ?? []);

		if (unrecognized.length > 0) return unrecognized;
	}

	return null;
}

export class LenientChatTransport<
	UI_MESSAGE extends UIMessage = UIMessage,
> extends DefaultChatTransport<UI_MESSAGE> {
	protected override processResponseStream(
		stream: ReadableStream<Uint8Array>,
	): ReadableStream<UIMessageChunk> {
		let buffer = "";

		const schema = uiMessageChunkSchema();
		const validate = schema.validate?.bind(schema);

		return stream
			.pipeThrough(new TextDecoderStream() as TransformStream<Uint8Array, string>)
			.pipeThrough(
				new TransformStream<string, UIMessageChunk>({
					async transform(text, controller) {
						buffer += text;
						const parts = buffer.split("\n");
						buffer = parts.pop() ?? "";

						for (const line of parts) {
							const trimmed = line.trim();
							if (!trimmed.startsWith("data:")) continue;
							const data = trimmed.slice(5).trim();
							if (data === "[DONE]") continue;

							try {
								const parsed = JSON.parse(data);

								if (!validate) {
									controller.enqueue(parsed as UIMessageChunk);
									continue;
								}

								const result = await validate(parsed);
								if (result.success) {
									controller.enqueue(result.value);
									continue;
								}

								// Validation failed — try stripping only the unrecognized keys
								const keysToStrip = extractKeysToStrip(result.error);
								if (keysToStrip?.length) {
									const stripped = { ...parsed };
									for (const key of keysToStrip) {
										delete stripped[key];
									}
									const retry = await validate(stripped);
									if (retry.success) {
										controller.enqueue(retry.value);
										continue;
									}
								}

								// Truly unknown event type — skip silently
							} catch {
								// Malformed JSON — skip
							}
						}
					},
				}),
			);
	}
}
