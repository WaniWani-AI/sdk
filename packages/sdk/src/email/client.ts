import { refusalMessage } from "@waniwani/core/shared/refusal";
import { WaniWaniError } from "../error.js";
import type { InternalConfig } from "../types.js";
import type {
	EmailClient,
	EmailSendInput,
	EmailSendResult,
	EmailVerification,
} from "./types.js";

const SDK_NAME = "@waniwani/sdk";
const SEND_PATH = "/api/mcp/modules/email/send";
const VERIFY_PATH = "/api/mcp/modules/email/verify";

export function createEmailClient(
	config: Pick<InternalConfig, "apiUrl" | "apiKey">,
): EmailClient {
	const { apiUrl, apiKey } = config;

	async function post<T>(path: string, body: unknown): Promise<T> {
		if (!apiKey) {
			throw new Error("WANIWANI_API_KEY is not set");
		}

		const response = await fetch(`${apiUrl.replace(/\/$/, "")}${path}`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json",
				"X-WaniWani-SDK": SDK_NAME,
			},
			body: JSON.stringify(body),
		});

		if (!response.ok) {
			const text = await response.text().catch(() => "");
			throw new WaniWaniError(
				refusalMessage(text, response.status, "Email API"),
				response.status,
			);
		}

		const json = (await response.json()) as { data: T };
		return json.data;
	}

	return {
		async send(input: EmailSendInput): Promise<EmailSendResult> {
			const data = await post<EmailSendResult>(SEND_PATH, {
				to: input.to,
				cc: input.cc,
				bcc: input.bcc,
				subject: input.subject,
				html: input.html,
				text: input.text,
				replyTo: input.replyTo,
				sessionId: input.sessionId,
			});
			return { id: data.id };
		},

		async verify(email: string): Promise<EmailVerification> {
			const data = await post<EmailVerification>(VERIFY_PATH, { email });
			return {
				result: data.result,
				...(data.reason !== undefined && { reason: data.reason }),
				...(data.suggestion !== undefined && { suggestion: data.suggestion }),
			};
		},
	};
}
