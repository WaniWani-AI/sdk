export interface EmailSendInput {
	/** One recipient address */
	to: string;
	/** Up to 998 characters */
	subject: string;
	/** The finished email, for example `await render(<Recap />)` from React Email. Sent as is, up to 512 KB. */
	html: string;
	/** Plain-text part, up to 512 KB. Leave it out and one is built from `html`. */
	text?: string;
	/** Address replies go to instead of the sender */
	replyTo?: string;
	/** Conversation this email belongs to, recorded on its log row */
	sessionId?: string;
}

export interface EmailSendResult {
	/** The log row for this send, listed under Modules > Email > Logs in the dashboard */
	id: string;
}

export interface EmailClient {
	/** Send one email from the agent behind your API key, as `"Agent name" <agent-name@notifications.waniwani.run>`. */
	send(input: EmailSendInput): Promise<EmailSendResult>;
}
