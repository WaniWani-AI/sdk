---
description: Start planning a Linear ticket implementation without creating a branch
argument-hint: <linear_ticket>
---

Start planning the Linear ticket specified in $ARGUMENTS.

## Steps

1. **Fetch the Linear ticket** using `mcp__linear__get_issue` with the ticket ID from $ARGUMENTS (e.g., "WAN-123")
   - If the ticket doesn't exist, inform the user and stop

2. **Mark the ticket as "In Progress"** using `mcp__linear__update_issue`:
   - Set the state to "In Progress"
   - This signals to the team that work has started on this ticket

3. **Display ticket information** to the user:
   - Title
   - Description
   - Status
   - Priority
   - Any linked issues or parent tickets

4. **Enter plan mode** using the EnterPlanMode tool to start planning the implementation:
   - The plan should be based on the ticket description and acceptance criteria
   - Consider the project's architecture and coding standards (from CLAUDE.md)
   - Break down the work into concrete implementation steps

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
/plan WAN-123
```

This will:
1. Fetch WAN-123 from Linear
2. Mark the ticket as "In Progress"
3. Enter plan mode with the ticket context

## When to Use /plan vs /implement

- Use `/plan` when you want to plan the work on an existing branch or without branch management
- Use `/implement` when you want to create a dedicated feature branch for the ticket

## Error Handling

- If the ticket ID is not provided, ask the user for it
- If the ticket doesn't exist in Linear, inform the user
