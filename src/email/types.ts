interface EmailSendFields {
	/** One recipient address */
	to: string;
	/** Copy recipients: one address or a list of up to 50 */
	cc?: string | string[];
	/** Blind copy recipients: one address or a list of up to 50 */
	bcc?: string | string[];
	/** Up to 998 characters */
	subject: string;
	/** Address replies go to instead of the sender */
	replyTo?: string;
	/** Conversation this email belongs to, recorded on its log row */
	sessionId?: string;
}

interface EmailHtmlContent {
	/** The finished email, for example `await render(<Recap />)` from React Email. Sent as is, up to 512 KB. */
	html: string;
	/** Plain-text part, up to 512 KB. Leave it out and one is built from `html`. */
	text?: string;
}

interface EmailTextContent {
	/** The finished email, for example `await render(<Recap />)` from React Email. Sent as is, up to 512 KB. */
	html?: string;
	/** Plain-text email, up to 512 KB, sent alone when `html` is left out. */
	text: string;
}

/** Pass `html`, `text` or both. */
export type EmailSendInput = EmailSendFields &
	(EmailHtmlContent | EmailTextContent);

export interface EmailSendResult {
	/** The log row for this send, listed under Modules > Email > Logs in the dashboard */
	id: string;
}

export interface EmailClient {
	/** Send one email from the agent behind your API key, as `"Agent name" <agent-name@notifications.waniwani.run>`. */
	send(input: EmailSendInput): Promise<EmailSendResult>;
}
