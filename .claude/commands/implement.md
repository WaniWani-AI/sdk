---
description: Start implementing a Linear ticket by creating a branch and entering plan mode
argument-hint: <linear_ticket>
---

Start implementing the Linear ticket specified in $ARGUMENTS.

## Steps

1. **Fetch the Linear ticket** using `mcp__linear__get_issue` with the ticket ID from $ARGUMENTS (e.g., "WAN-123")
   - If the ticket doesn't exist, inform the user and stop

2. **Get the current git user** using `git config user.name` to determine the branch prefix
   - Convert to lowercase and replace spaces with hyphens (e.g., "John Doe" → "john-doe")

3. **Create and checkout a new branch** with the naming convention: `{user}/{linear_ticket_id}`
   - Example: `maxime/WAN-123`
   - Use: `git checkout -b {user}/{ticket_id}`
   - If the branch already exists, check it out instead: `git checkout {user}/{ticket_id}`

4. **Mark the ticket as "In Progress"** using `mcp__linear__update_issue`:
   - Set the state to "In Progress"
   - This signals to the team that work has started on this ticket

5. **Display ticket information** to the user:
   - Title
   - Description
   - Status
   - Priority
   - Any linked issues or parent tickets

6. **Enter plan mode** using the EnterPlanMode tool to start planning the implementation:
   - The plan should be based on the ticket description and acceptance criteria
   - Consider the project's architecture and coding standards (from CLAUDE.md)
   - Break down the work into concrete implementation steps

## Branch Naming

- Format: `{git_username}/{LINEAR_TICKET_ID}`
- Git username: lowercase, spaces replaced with hyphens
- Ticket ID: uppercase (e.g., WAN-123)

Examples:
- User "maxime", ticket "WAN-456" → `maxime/WAN-456`
- User "John Doe", ticket "wan-789" → `john-doe/WAN-789`

## Planning Guidelines

When entering plan mode, focus on:

1. **Understanding the scope** - What exactly needs to be built?
2. **Identifying affected files** - Which files need to be created or modified?
3. **Dependencies** - What needs to happen first? (schema → types → API → UI)
4. **Testing approach** - How will the implementation be verified?
5. **Edge cases** - What could go wrong?

Structure the plan following the project's layered approach:
1. Database changes (if any)
2. Type definitions and Zod schemas
3. API endpoints
4. Backend logic
5. UI components

## Example Usage

```
/implement WAN-123
```

This will:
1. Fetch WAN-123 from Linear
2. Create branch `{your-username}/WAN-123`
3. Mark the ticket as "In Progress"
4. Enter plan mode with the ticket context

## Error Handling

- If the ticket ID is not provided, ask the user for it
- If the ticket doesn't exist in Linear, inform the user
- If git operations fail, report the error and suggest fixes
