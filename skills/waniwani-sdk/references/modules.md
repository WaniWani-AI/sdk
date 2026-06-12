# Modules — pre-built integrations for MCP flows

Modules are hosted integrations exposed as `ctx.waniwani.modules.*` inside flow node handlers when the server is wrapped with `withWaniwani()`. They are a **free tier** feature: they require `WANIWANI_API_KEY` plus a `projectId` in `waniwani.json`.

## Email module

Send emails from flow nodes via `ctx.waniwani.modules.email.send()`. Sending, domain verification, templates, and delivery logs are managed in the WaniWani dashboard under **Modules → Email**.

### Requirements

- `WANIWANI_API_KEY` set in the environment
- `projectId` set in `waniwani.json` — without it, `send()` rejects with a configuration error

### Sending

Exactly one of `content`, `html`, or `templateId` must be provided.

```ts
// Inline content — wrapped in a basic WaniWani layout
await ctx.waniwani.modules.email.send({
  to: "user@example.com",
  subject: "Welcome!",
  content: "<h1>Welcome to our platform!</h1>",
});

// Raw HTML — sent as-is
await ctx.waniwani.modules.email.send({
  to: "user@example.com",
  subject: "Custom Email",
  html: "<!DOCTYPE html><html>...</html>",
});

// Saved template — templateId is the template's UUID
// (dashboard → Modules → Email → Templates → "Copy template ID")
await ctx.waniwani.modules.email.send({
  to: "user@example.com",
  subject: "Order Confirmation",
  templateId: "550e8400-e29b-41d4-a716-446655440000",
  variables: { orderId: "12345", customerName: "John" },
});
```

`replyTo` is optional on all variants. Template variables use `{{variableName}}` syntax in the template HTML and subject; values are HTML-escaped before substitution in the body.

### Result

```ts
type EmailSendResult = {
  id: string;      // Resend email id (used for delivery/open/click tracking)
  success: boolean;
};
```

### Types

`EmailModule`, `EmailSendInput`, `EmailSendResult`, and `ModulesContext` are exported from `@waniwani/sdk/mcp`.
