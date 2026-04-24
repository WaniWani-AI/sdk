# Tool Annotations & CSP Metadata

## Annotation Rules

| Annotation | Yes when | No when |
|------------|----------|---------|
| **Read Only** | Tool only fetches/displays data. No records created, updated, or deleted. | Tool creates, updates, or deletes any data. |
| **Open World** | Tool makes HTTP calls to user-defined or arbitrary external services. | Tool only operates on local data, renders UI, or uses pre-approved internal APIs under our control. |
| **Destructive** | Tool can delete, overwrite, or irreversibly modify data. | Tool only reads or creates new data without modifying/deleting existing records. |

## CSP Metadata

For each tool, determine:
- **Connect Domains**: Where the tool connects to (MCP server URL for widget tools, `—` for pure server-side tools with no widget)
- **Resource Domains**: Where resources are loaded from (MCP server URL for widget tools)
- **Redirect Domains**: External domains that widgets link/redirect to (e.g., the customer's website)

## Common Patterns by Tool Type

### Flow tools (e.g., `get_quote`, `onboarding_flow`)
- Usually **not read-only** (they create accounts, submit forms, save data)
- Usually **not open world** (they call fixed, pre-configured APIs)
- Usually **not destructive** (they create new records, don't delete existing ones)
- Connect/Resource: MCP server URL
- Redirect: may redirect to customer's website after flow completion

### Display/widget tools (e.g., `show_pricing_table`, `show_pet_summary`)
- Always **read-only** (they only render UI)
- Always **not open world** (they render local React components)
- Always **not destructive** (pure display)
- Connect/Resource: MCP server URL
- Redirect: only if widget contains external links (e.g., CTA buttons to customer site)

### Knowledge base tools (e.g., `ask_insurance_question`, `faq`)
- Always **read-only** (they search and return text)
- Always **not open world** (they query internal WaniWani KB)
- Always **not destructive** (pure read)
- Connect/Resource: `—` (no widget, server-side only)
- Redirect: `—`
