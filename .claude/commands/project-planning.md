---
description: Create atomic implementation tickets for a Linear project based on its description
argument-hint: <project-name>
---

Create implementation tickets for the Linear project specified in $ARGUMENTS.

## Steps

1. **Fetch project details** using `mcp__linear__get_project` with the project name from $ARGUMENTS
2. **Fetch team info** using `mcp__linear__list_teams` to get the team ID for creating issues
3. **Analyze the project description** to understand:
   - The overall goal and scope
   - Key implementation areas (database, API, UI, etc.)
   - Dependencies between components
4. **Break down into atomic tickets** following these principles:
   - Each ticket should be completable by a single agent in isolation
   - Tickets should have clear inputs and outputs
   - Dependencies should be explicit (use Linear's blocking relations)
   - Group by layer: Schema → Types → API → Backend Logic → UI
5. **Present the plan for approval** - Show the user the complete ticket breakdown:
   - Display each planned ticket with title and description summary
   - Show the dependency graph (what blocks what)
   - Highlight parallelization opportunities
   - Ask the user to approve before proceeding
6. **Wait for user approval** - Use AskUserQuestion to get explicit confirmation:
   - Option to approve and create all tickets
   - Option to request modifications to the plan
   - Option to cancel
7. **Create tickets in Linear** (only after approval) using `mcp__linear__create_issue` for each ticket
8. **Set up dependencies** using the `blocks` parameter when creating issues
9. **Summarize** the created tickets to the user

## Plan Presentation Format

Before creating tickets, present the plan to the user in this format:

```
## Proposed Implementation Plan for [Project Name]

### Summary
[Brief overview of the approach and total number of tickets]

### Ticket Breakdown

#### Layer 1: Database (X tickets)
1. **[Title]** - [One-line description]
2. **[Title]** - [One-line description]

#### Layer 2: Types (X tickets)
3. **[Title]** - [One-line description]
   - Blocked by: #1

#### Layer 3: API (X tickets)
4. **[Title]** - [One-line description]
   - Blocked by: #1, #3

[Continue for all layers...]

### Dependency Graph

    #1 Database Schema
     ├── #3 Types (blocked by #1)
     │    └── #5 Service (blocked by #3, #4)
     └── #4 API Endpoints (blocked by #1)
          └── #6 UI Components (blocked by #4)
    #2 Config Setup (independent)

### Parallelization Opportunities
- **Phase 1** (can start immediately): #1, #2
- **Phase 2** (after Phase 1): #3, #4
- **Phase 3** (after Phase 2): #5, #6
```

After presenting, use AskUserQuestion with options:
- "Create all tickets" (Recommended)
- "Modify the plan" - User can request changes
- "Cancel"

## Ticket Design Principles

### Atomicity
Each ticket should:
- Focus on a single concern (one table, one endpoint, one component)
- Be implementable without context from other in-progress tickets
- Have a clear "definition of done"

### Parallelization
Structure tickets so multiple agents can work simultaneously:
- Database schema tickets can run in parallel (no cross-table dependencies)
- API endpoints can be parallelized once schemas exist
- UI components can be parallelized once APIs exist

### Layered Approach
Create tickets in this order (earlier layers block later ones):

1. **Database Layer**
   - One ticket per table/schema change
   - Include column definitions, indexes, relations

2. **Types Layer**
   - Zod schemas and TypeScript types
   - Can often be combined with DB schema ticket

3. **API Layer**
   - One ticket per resource (CRUD endpoints)
   - Include request/response schemas

4. **Backend Logic Layer**
   - Background jobs, workflows, integrations
   - One ticket per function/workflow

5. **UI Layer**
   - One ticket per page or major component
   - Include routes, forms, displays

## Ticket Format

Each ticket should include:

```markdown
## Overview
[Brief description of what this ticket accomplishes]

## Implementation Details
[Specific technical requirements, schemas, endpoints, etc.]

## Acceptance Criteria
- [ ] Criterion 1
- [ ] Criterion 2

## Files to Create/Modify
- `path/to/file.ts` - description
```

## Creating Issues

When creating issues, use:
- `team`: "WaniWani" (or fetch from project)
- `project`: The project name from $ARGUMENTS
- `priority`: 2 (High) for foundational work, 3 (Normal) for features
- `blocks`: Array of issue identifiers that this ticket blocks

## Example Ticket Breakdown

For a "User Notifications" project:

1. **WAN-XX**: Add notifications database schema
   - Blocks: WAN-XX+1, WAN-XX+2
2. **WAN-XX+1**: Add notification types and Zod schemas
   - Blocked by: WAN-XX
3. **WAN-XX+2**: Create notifications API endpoints
   - Blocked by: WAN-XX
4. **WAN-XX+3**: Create notification sender service
   - Blocked by: WAN-XX+1, WAN-XX+2
5. **WAN-XX+4**: Add notifications UI components
   - Blocked by: WAN-XX+2

## Output

After creating all tickets, provide a summary:

```
Created X tickets for [Project Name]:

| ID | Title | Blocked By |
|----|-------|------------|
| WAN-XX | Title | - |
| WAN-XX | Title | WAN-XX |
...

Parallelization opportunities:
- Tickets A, B, C can run in parallel (no dependencies)
- After A completes, tickets D, E can start
```
