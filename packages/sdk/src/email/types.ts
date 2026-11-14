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

/**
 * - `valid`: keep the address.
 * - `invalid`: the address cannot receive mail. Ask the user for another one.
 * - `risky`: the address may be wrong. Ask the user to confirm it, and keep it if they do.
 * - `unknown`: the check could not finish. Keep the address.
 */
export type EmailVerificationResult = "valid" | "invalid" | "risky" | "unknown";

/**
 * - `syntax`: not a well-formed address, or a Gmail username Gmail does not allow
 * - `placeholder`: `test@` or `example@`
 * - `disposable`: a temporary inbox service
 * - `no_mail_server`: the domain does not exist or refuses all mail
 * - `no_mx_record`: the domain has a website but no mail server record
 * - `domain_typo`: the domain looks like a typo of a common provider, see `suggestion`
 * - `dns_error`: the DNS lookup failed
 */
export type EmailVerificationReason =
	| "syntax"
	| "placeholder"
	| "disposable"
	| "no_mail_server"
	| "no_mx_record"
	| "domain_typo"
	| "dns_error";

export interface EmailVerification {
	result: EmailVerificationResult;
	/** Why the address is not `valid`. Absent when it is. */
	reason?: EmailVerificationReason;
	/** The corrected address when the domain looks like a typo, for example `sam@gmail.com` for `sam@gmial.com` */
	suggestion?: string;
}

export interface EmailClient {
	/** Send one email from the agent behind your API key, as `"Agent name" <agent-name@notifications.waniwani.run>`. */
	send(input: EmailSendInput): Promise<EmailSendResult>;
	/** Check that an address a user typed can receive mail, before your agent keeps it. Sends no email. */
	verify(email: string): Promise<EmailVerification>;
}
