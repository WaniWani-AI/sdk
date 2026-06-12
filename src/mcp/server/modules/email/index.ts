/**
 * Email module for sending emails from MCP flows.
 *
 * Available as `ctx.waniwani.modules.email` inside flow node handlers
 * when the server is wrapped with `withWaniwani()`.
 */

export type EmailSendInput = {
	to: string;
	subject: string;
	replyTo?: string;
} & (
	| { content: string; html?: never; templateId?: never; variables?: never }
	| { html: string; content?: never; templateId?: never; variables?: never }
	| {
			templateId: string;
			variables?: Record<string, string>;
			content?: never;
			html?: never;
	  }
);

type EmailSendApiBody =
	| {
			type: "content";
			to: string;
			subject: string;
			replyTo?: string;
			content: string;
	  }
	| {
			type: "html";
			to: string;
			subject: string;
			replyTo?: string;
			html: string;
	  }
	| {
			type: "template";
			to: string;
			subject: string;
			replyTo?: string;
			templateId: string;
			variables?: Record<string, string>;
	  };

export type EmailSendResult = {
	id: string;
	success: boolean;
};

export interface EmailModule {
	/**
	 * Send an email.
	 *
	 * @example
	 * // Send with inline content (wrapped in a basic template)
	 * await ctx.waniwani.modules.email.send({
	 *   to: "user@example.com",
	 *   subject: "Welcome!",
	 *   content: "<h1>Welcome to our platform!</h1>",
	 * });
	 *
	 * @example
	 * // Send with raw HTML
	 * await ctx.waniwani.modules.email.send({
	 *   to: "user@example.com",
	 *   subject: "Custom Email",
	 *   html: "<!DOCTYPE html><html>...</html>",
	 * });
	 *
	 * @example
	 * // Send with a saved template — templateId is the template's UUID,
	 * // available via "Copy template ID" in the dashboard.
	 * await ctx.waniwani.modules.email.send({
	 *   to: "user@example.com",
	 *   subject: "Order Confirmation",
	 *   templateId: "550e8400-e29b-41d4-a716-446655440000",
	 *   variables: { orderId: "12345", customerName: "John" },
	 * });
	 */
	send(input: EmailSendInput): Promise<EmailSendResult>;
}

export function createEmailModule(config: {
	apiUrl: string;
	apiKey: string;
	projectId: string;
}): EmailModule {
	const { apiUrl, apiKey, projectId } = config;

	return {
		async send(input: EmailSendInput): Promise<EmailSendResult> {
			let body: EmailSendApiBody;

			if ("content" in input && input.content) {
				body = {
					type: "content",
					to: input.to,
					subject: input.subject,
					replyTo: input.replyTo,
					content: input.content,
				};
			} else if ("html" in input && input.html) {
				body = {
					type: "html",
					to: input.to,
					subject: input.subject,
					replyTo: input.replyTo,
					html: input.html,
				};
			} else if ("templateId" in input && input.templateId) {
				body = {
					type: "template",
					to: input.to,
					subject: input.subject,
					replyTo: input.replyTo,
					templateId: input.templateId,
					variables: input.variables,
				};
			} else {
				throw new Error(
					"EmailSendInput must have one of: content, html, or templateId",
				);
			}

			const response = await fetch(
				`${apiUrl}/api/mcp/projects/${projectId}/modules/email/send`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${apiKey}`,
						"X-WaniWani-SDK": "@waniwani/sdk",
					},
					body: JSON.stringify(body),
				},
			);

			if (!response.ok) {
				const errorBody = await response.text();
				throw new Error(
					`Failed to send email: ${response.status} ${errorBody}`,
				);
			}

			const result = (await response.json()) as {
				success: boolean;
				data: EmailSendResult;
			};
			return result.data;
		},
	};
}
