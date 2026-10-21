import { WaniWaniError } from "../error.js";
import { refusalMessage } from "../shared/refusal.js";
import type { InternalConfig } from "../types.js";
import type { EmailClient, EmailSendInput, EmailSendResult } from "./types.js";

const SDK_NAME = "@waniwani/sdk";
const SEND_PATH = "/api/mcp/modules/email/send";

export function createEmailClient(
	config: Pick<InternalConfig, "apiUrl" | "apiKey">,
): EmailClient {
	const { apiUrl, apiKey } = config;

	return {
		async send(input: EmailSendInput): Promise<EmailSendResult> {
			if (!apiKey) {
				throw new Error("WANIWANI_API_KEY is not set");
			}

			const response = await fetch(`${apiUrl.replace(/\/$/, "")}${SEND_PATH}`, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${apiKey}`,
					"Content-Type": "application/json",
					"X-WaniWani-SDK": SDK_NAME,
				},
				body: JSON.stringify({
					to: input.to,
					cc: input.cc,
					bcc: input.bcc,
					subject: input.subject,
					html: input.html,
					text: input.text,
					replyTo: input.replyTo,
					sessionId: input.sessionId,
				}),
			});

			if (!response.ok) {
				const text = await response.text().catch(() => "");
				throw new WaniWaniError(
					refusalMessage(text, response.status, "Email API"),
					response.status,
				);
			}

			const json = (await response.json()) as { data: EmailSendResult };
			return { id: json.data.id };
		},
	};
}
