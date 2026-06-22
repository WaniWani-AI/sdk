/**
 * Modules context providing pre-built integrations for MCP flows.
 *
 * Available as `ctx.waniwani.modules` inside flow node handlers
 * when the server is wrapped with `withWaniwani()`.
 */

export type { EmailModule, EmailSendInput, EmailSendResult } from "./email";
export { createEmailModule } from "./email";

import type { EmailModule } from "./email";

export interface ModulesContext {
	/**
	 * Email module for sending emails.
	 *
	 * @example
	 * await ctx.waniwani.modules.email.send({
	 *   to: "user@example.com",
	 *   subject: "Welcome!",
	 *   content: "<h1>Hello!</h1>",
	 * });
	 */
	readonly email: EmailModule;
}
