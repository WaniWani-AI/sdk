import { toJSONSchema } from "zod";
import { WaniWaniError } from "../error.js";
import type { InternalConfig } from "../types.js";
import type {
	DocumentExtractInput,
	DocumentExtractResult,
	DocumentsClient,
} from "./types.js";

const SDK_NAME = "@waniwani/sdk";
const EXTRACT_PATH = "/api/mcp/modules/documents/extract";

interface ExtractWireResponse {
	fields: unknown;
	pageCount: number;
	pageConfidence: number | null;
	documentId: string;
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
						url: input.url,
						filename: input.filename,
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
					text || `Documents API error: HTTP ${response.status}`,
					response.status,
				);
			}

			const json = (await response.json()) as { data: ExtractWireResponse };
			const { fields, pageCount, pageConfidence, documentId } = json.data;

			return {
				fields: input.schema.parse(fields),
				pageCount,
				pageConfidence,
				documentId,
			};
		},
	};
}
