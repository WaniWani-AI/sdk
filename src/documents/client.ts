import { WaniWaniError } from "../error.js";
import type { InternalConfig } from "../types.js";
import type {
	DocumentExtractInput,
	DocumentExtractResult,
	DocumentExtractStoredInput,
	DocumentSchema,
	DocumentsClient,
} from "./types.js";

const SDK_NAME = "@waniwani/sdk";
const EXTRACT_PATH = "/api/mcp/modules/documents/extract";

/** Method syntax makes the parameter bivariant, so a structural schema is accepted without an assertion. */
interface ZodModule {
	toJSONSchema(schema: DocumentSchema<unknown>): Record<string, unknown>;
}

interface ExtractWireResponse {
	fields: unknown;
	pageCount: number;
	pageConfidence: number | null;
	documentId: string;
}

/**
 * The platform puts the machine-readable code on `message` and the human reason
 * on `detail`, so a refusal reads as "UNSUPPORTED_DOCUMENT_TYPE: photo.heic is
 * not one of ...". The raw body is the fallback.
 */
function refusalMessage(body: string, status: number): string {
	try {
		const parsed: unknown = JSON.parse(body);
		if (parsed !== null && typeof parsed === "object") {
			const code =
				"message" in parsed && typeof parsed.message === "string"
					? parsed.message
					: "";
			const detail =
				"detail" in parsed && typeof parsed.detail === "string"
					? parsed.detail
					: "";
			if (code && detail) {
				return `${code}: ${detail}`;
			}
			if (code) {
				return code;
			}
			if (detail) {
				return detail;
			}
		}
	} catch {
		// A non-JSON body is surfaced as-is below.
	}
	return body || `Documents API error: HTTP ${status}`;
}

function isStoredInput<T>(
	input: DocumentExtractInput<T>,
): input is DocumentExtractStoredInput<T> {
	return "documentId" in input && typeof input.documentId === "string";
}

/** The platform's body is a union, so each branch's fields must travel alone. */
function sourceFields<T>(
	input: DocumentExtractInput<T>,
): Record<string, string> {
	if (isStoredInput(input)) {
		return { documentId: input.documentId };
	}
	return { url: input.url, filename: input.filename };
}

export function createDocumentsClient(
	config: Pick<InternalConfig, "apiUrl" | "apiKey">,
): DocumentsClient {
	const { apiUrl, apiKey } = config;

	return {
		async extract<T>(
			input: DocumentExtractInput<T>,
		): Promise<DocumentExtractResult<T>> {
			if (!apiKey) {
				throw new Error("WANIWANI_API_KEY is not set");
			}

			// zod is an optional peer dependency and this module is reachable from the
			// package root, so a top-level import would break every consumer that only
			// uses tracking.
			const { toJSONSchema }: ZodModule = await import("zod");

			const response = await fetch(
				`${apiUrl.replace(/\/$/, "")}${EXTRACT_PATH}`,
				{
					method: "POST",
					headers: {
						Authorization: `Bearer ${apiKey}`,
						"Content-Type": "application/json",
						"X-WaniWani-SDK": SDK_NAME,
					},
					body: JSON.stringify({
						...sourceFields(input),
						schema: toJSONSchema(input.schema),
						pages: input.pages,
						sessionId: input.sessionId,
						correlationId: input.correlationId,
					}),
				},
			);

			if (!response.ok) {
				const text = await response.text().catch(() => "");
				throw new WaniWaniError(
					refusalMessage(text, response.status),
					response.status,
				);
			}

			const json = (await response.json()) as { data: ExtractWireResponse };
			const { fields, pageCount, pageConfidence, documentId } = json.data;

			return {
				fields: input.schema.parse(fields),
				pageCount,
				pageConfidence: pageConfidence ?? null,
				documentId,
			};
		},
	};
}
