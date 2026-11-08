/**
 * A forward-compatible chat transport that handles version mismatches between
 * the server's `ai` package and the client's `ai` package.
 *
 * Two layers of protection:
 * 1. When a chunk fails validation on fields the client's schema does not
 *    accept (keys an AI SDK 6 `strictObject` does not know, such as AI SDK 7's
 *    `toolMetadata` or `citations`, or a value outside an enum, such as the
 *    `interrupted` finish reason), strips only those fields and retries. This
 *    preserves events like tool outputs so widgets keep rendering.
 * 2. If the chunk is a completely unknown event type, silently skips it.
 *    The chat keeps working; only the unrecognised visual is missing.
 *
 * The same code runs on AI SDK 6 and AI SDK 7: it validates with the
 * `uiMessageChunkSchema` of whichever `ai` the page installed.
 */

import type { UIMessage, UIMessageChunk } from "ai";
import { DefaultChatTransport, uiMessageChunkSchema } from "ai";

type ChunkValidation<CHUNK> =
	| { success: true; value: CHUNK }
	| { success: false; error: unknown };

/** The `validate` of an `ai` schema, AI SDK 6 and 7 alike. */
export type ChunkValidator<CHUNK> = (
	value: unknown,
) => ChunkValidation<CHUNK> | PromiseLike<ChunkValidation<CHUNK>>;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

/**
 * The Zod issues behind a failed `validate`. AI SDK 6 hands back the
 * `ZodError` itself; a `TypeValidationError` carries it as its `cause`.
 */
function issuesOf(error: unknown): unknown[] | null {
	for (const source of [error, isRecord(error) ? error.cause : undefined]) {
		if (isRecord(source)) {
			const issues = source.issues ?? source.errors;
			if (Array.isArray(issues)) {
				return issues;
			}
		}
	}
	return null;
}

function topLevelKey(issue: Record<string, unknown>): string | undefined {
	const path = issue.path;
	return Array.isArray(path) && typeof path[0] === "string"
		? path[0]
		: undefined;
}

/**
 * Names the top-level fields a validation error rejects on the chunk's own
 * type: keys the schema does not know, and keys whose value it does not accept.
 *
 * Ideally we'd use Zod's `.strip()` to silently drop unknown keys, but
 * `uiMessageChunkSchema()` wraps the Zod union in a `zodSchema()` closure
 * that only exposes a `.validate` method — the raw Zod schema is unreachable,
 * so we can't call `.strip()` on each union branch. Duplicating the schema
 * here would be fragile and defeat the forward-compatibility goal.
 *
 * Instead we read the Zod error: a chunk that matches no branch fails with
 * `invalid_union` and the issues of every branch. The branch with no issue on
 * `type` is the chunk's own type, and its issues name the fields to drop. The
 * caller validates again without them, so a required field never goes missing.
 */
function fieldsToStrip(error: unknown): string[] | null {
	const unionIssue = issuesOf(error)?.find(
		(issue) => isRecord(issue) && issue.code === "invalid_union",
	);
	if (!isRecord(unionIssue) || !Array.isArray(unionIssue.errors)) {
		return null;
	}

	for (const branchIssues of unionIssue.errors) {
		if (!Array.isArray(branchIssues)) {
			continue;
		}
		const issues = branchIssues.filter(isRecord);
		// A branch for another type fails on `type` itself.
		if (issues.some((issue) => topLevelKey(issue) === "type")) {
			continue;
		}

		const fields = new Set<string>();
		for (const issue of issues) {
			if (issue.code === "unrecognized_keys" && Array.isArray(issue.keys)) {
				for (const key of issue.keys) {
					if (typeof key === "string") {
						fields.add(key);
					}
				}
				continue;
			}
			const key = topLevelKey(issue);
			if (key !== undefined) {
				fields.add(key);
			}
		}
		if (fields.size > 0) {
			return [...fields];
		}
	}

	return null;
}

async function lenientChunk<CHUNK>(
	parsed: unknown,
	validate: ChunkValidator<CHUNK>,
): Promise<CHUNK | undefined> {
	const result = await validate(parsed);
	if (result.success) {
		return result.value;
	}
	const fields = fieldsToStrip(result.error);
	if (!fields || !isRecord(parsed)) {
		// An unknown event type: skip it.
		return undefined;
	}
	const stripped = { ...parsed };
	for (const field of fields) {
		delete stripped[field];
	}
	const retry = await validate(stripped);
	return retry.success ? retry.value : undefined;
}

/**
 * Reads a UI message stream (server-sent events) into the chunks `validate`
 * accepts, stripping the fields it rejects and skipping event types it does
 * not know and lines that are not JSON.
 */
export function lenientChunkStream<CHUNK>(
	stream: ReadableStream<Uint8Array>,
	validate: ChunkValidator<CHUNK>,
): ReadableStream<CHUNK> {
	const decoder = new TextDecoder();
	let buffer = "";

	return stream.pipeThrough(
		new TransformStream<Uint8Array, CHUNK>({
			async transform(bytes, controller) {
				buffer += decoder.decode(bytes, { stream: true });
				const lines = buffer.split("\n");
				buffer = lines.pop() ?? "";

				for (const line of lines) {
					const trimmed = line.trim();
					if (!trimmed.startsWith("data:")) {
						continue;
					}
					const data = trimmed.slice(5).trim();
					if (data === "[DONE]") {
						continue;
					}

					let parsed: unknown;
					try {
						parsed = JSON.parse(data);
					} catch {
						// Malformed JSON — skip
						continue;
					}
					const chunk = await lenientChunk(parsed, validate);
					if (chunk !== undefined) {
						controller.enqueue(chunk);
					}
				}
			},
		}),
	);
}

export class LenientChatTransport<
	UI_MESSAGE extends UIMessage = UIMessage,
> extends DefaultChatTransport<UI_MESSAGE> {
	protected override processResponseStream(
		stream: ReadableStream<Uint8Array>,
	): ReadableStream<UIMessageChunk> {
		const schema = uiMessageChunkSchema();
		const validate = schema.validate?.bind(schema);
		return validate
			? lenientChunkStream(stream, validate)
			: super.processResponseStream(stream);
	}
}
